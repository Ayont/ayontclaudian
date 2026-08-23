import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { expandProviderCommandInput } from '../../../core/providers/commands/expandProviderCommandInput';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
import { buildEstimatedUsageInfo, estimateTokensForTexts } from '../../../core/providers/usage/estimateUsage';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { DSH_PROVIDER_CAPABILITIES } from '../capabilities';
import { syncDshSelectionToHarness } from '../harnessBridge';
import { getDshModelContextWindow, resolveDshModelSelection } from '../modelOptions';
import { DSH_PROVIDER_ID,getDshProviderSettings } from '../settings';
import { buildPersistedDshState, type DshProviderState,getDshState } from '../types';
import { buildDshPromptText } from './buildDshPrompt';
import { buildDshLaunchSpec } from './DshLaunchSpec';
import { buildDshRuntimeEnv } from './DshRuntimeEnvironment';
import { findNewestDshSessionDir, getDshHome } from './DshSessionStore';
import { buildDshUsageInfo, type DshTurnMetadata } from './dshSessionEvents';
import { createDshTailState, tailDshSession } from './dshSessionTail';
import { DSH_KEEPALIVE_INTERVAL_MS, DSH_KEEPALIVE_MAX_SILENCE_MS } from './keepalive';

/**
 * Single-turn subprocess runtime for the DeepSeek Harness (`dsh`) CLI.
 *
 * Each turn spawns `dsh --profile headless <prompt>` in the vault. The headless
 * runner prints ONLY the final assistant text and exits 0/1, so the turn stays
 * silent until completion: a keepalive heartbeat covers the watchdog, and the
 * response arrives as one text chunk at the end. Conversation continuity is
 * client-side history replay inside the prompt (no resume flag exists).
 */
export class DshChatRuntime implements ChatRuntime {
  readonly providerId = DSH_PROVIDER_ID;

  private lastSession: DshProviderState | null = null;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return DSH_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: request.text,
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    // Nothing to restore into the CLI (stateless headless runs); the recorded
    // session reference only rides along for cleanup.
    this.lastSession = conversation ? getDshState(conversation.providerState) : null;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getDshProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }
    const resolved = this.plugin.getResolvedProviderCliPath(DSH_PROVIDER_ID);
    this.setReady(Boolean(resolved));
    return Boolean(resolved);
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getDshProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'DeepSeek Harness ist deaktiviert. Aktiviere es in den Einstellungen.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(DSH_PROVIDER_ID);
    if (!command) {
      yield { type: 'error', content: 'Konnte das `dsh`-Binary nicht finden. Lege den CLI-Pfad in den DeepSeek-Harness-Einstellungen fest.' };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildDshRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, DSH_PROVIDER_ID);
    const model = resolveDshModelSelection(
      settingsBag,
      typeof settingsBag.model === 'string' ? settingsBag.model : '',
    );
    // A toolbar pick must reach the harness before the run reads its own
    // selection file; no-op unless the two actually differ.
    if (model.includes('|')) {
      syncDshSelectionToHarness(model);
    }

    // Expand a chosen vault command/skill client-side — print-mode CLIs can't
    // expand `/command` or `$skill` tokens themselves. Best-effort.
    let rawPrompt = turn.request.text;
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(DSH_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        rawPrompt = expandProviderCommandInput(turn.request.text, entries);
      }
    } catch {
      rawPrompt = turn.request.text;
    }

    turn.request = { ...turn.request, text: rawPrompt };
    const promptText = buildDshPromptText(turn.request, conversationHistory ?? []);

    const launchSpec = buildDshLaunchSpec({ command, cwd, env, envText, prompt: promptText });

    yield { type: 'user_message_start', content: turn.request.text };

    let proc: ChildProcessWithoutNullStreams;
    let resolvedSpawnSpec: WindowsCmdShimSpawnSpec;
    try {
      resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec(launchSpec);
      proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
        cwd,
        env: {
          ...env,
          PATH: getEnhancedPath(env.PATH, path.isAbsolute(command) ? command : undefined),
        },
        stdio: 'pipe',
        windowsHide: true,
        ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Failed to launch dsh.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    proc.stdin.end();

    // Live view: the headless runner is stdout-silent by design, but it writes
    // a full record stream into its compressed session transcript as work
    // happens — assistant deltas, every inner tool dispatch with its result,
    // retries, compaction and real token counts. Tailing that file turns the
    // silent wait into the same live view the other providers give.
    let liveStreamedText = false;
    let tailState = createDshTailState();
    let tailFile: string | null = null;
    let tailInFlight = false;
    // Facts recovered from the transcript; they replace the end-of-turn
    // estimate whenever dsh actually reported them.
    const liveMetadata: DshTurnMetadata = {};
    const contextWindow = getDshModelContextWindow(model);
    const tailTimer = window.setInterval(() => {
      // A slow tick must not queue more work behind itself.
      if (tailInFlight) {
        return;
      }
      tailInFlight = true;
      void (async () => {
        try {
          if (!tailFile) {
            const found = findNewestDshSessionDir(getDshHome(), turnStartedAtMs);
            if (!found) return;
            tailFile = path.join(found.dir, 'session.jsonl.zstd');
          }
          const result = await tailDshSession(tailFile, tailState);
          tailState = result.state;
          for (const chunk of result.chunks) {
            if (chunk.type === 'text') liveStreamedText = true;
            pendingChunks.push(chunk);
          }
          Object.assign(liveMetadata, result.metadata);
          const usage = buildDshUsageInfo(result.metadata, contextWindow);
          if (usage) {
            pendingChunks.push({ type: 'usage', usage });
          }
          if (pendingChunks.length > 0) signal();
        } catch {
          // The live view is best-effort; never fail a turn over it.
        } finally {
          tailInFlight = false;
        }
      })();
    }, 800);

    // The headless runner is silent by design until its final line; heartbeat
    // so the watchdog does not kill healthy agentic work mid-flight.
    const turnStartedAtMs = Date.now() - 1_000;
    const keepaliveTimer = window.setInterval(() => {
      if (Date.now() - turnStartedAtMs > DSH_KEEPALIVE_MAX_SILENCE_MS) {
        window.clearInterval(keepaliveTimer);
        return;
      }
      if (proc.exitCode === null) {
        pendingChunks.push({ type: 'keepalive' });
        signal();
      }
    }, DSH_KEEPALIVE_INTERVAL_MS);

    let stdoutBuffer = '';
    let stderr = '';
    const pendingChunks: StreamChunk[] = [];

    let finished = false;
    let exitInfo: { code: number | null; error?: Error } = { code: null };
    let wake: (() => void) | null = null;
    const signal = (): void => {
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      signal();
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const onExit = (info: { code: number | null; error?: Error }): void => {
      exitInfo = info;
      finished = true;
      signal();
    };
    proc.on('error', (error) => onExit({ code: null, error }));
    proc.on('close', (code) => onExit({ code }));

    try {
      while (true) {
        while (pendingChunks.length > 0) {
          const chunk = pendingChunks.shift() as StreamChunk;
          yield chunk;
        }
        if (finished) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    } finally {
      window.clearInterval(tailTimer);
      window.clearInterval(keepaliveTimer);
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }

    if (exitInfo.error) {
      yield { type: 'error', content: this.formatError(exitInfo.error.message, stderr) };
      yield { type: 'done' };
      return;
    }

    if (exitInfo.code !== 0 && exitInfo.code !== null) {
      yield {
        type: 'error',
        content: this.formatError(`dsh exited with code ${exitInfo.code}`, stderr),
      };
      yield { type: 'done' };
      return;
    }

    const responseText = stdoutBuffer.trim();
    if (!responseText) {
      yield { type: 'error', content: this.formatError('dsh lieferte keine Antwort.', stderr) };
      yield { type: 'done' };
      return;
    }

    this.currentTurnMetadata.wasSent = true;
    // When the transcript tail already streamed this answer live, replaying
    // the final stdout line would duplicate the whole message.
    if (!liveStreamedText) {
      yield { type: 'text', content: responseText };
    }

    // Capture the transcript directory dsh just flushed (informational).
    try {
      const found = findNewestDshSessionDir(getDshHome(), turnStartedAtMs);
      if (found) {
        this.lastSession = { sessionId: found.sessionId, sessionDir: found.dir };
      }
    } catch {
      // Discovery is best-effort; never fail a completed turn over it.
    }

    // Prefer the transcript's own token counts; only fall back to estimating
    // from history + prompt + response when dsh reported nothing.
    const measuredUsage = buildDshUsageInfo(liveMetadata, contextWindow);
    if (measuredUsage) {
      yield {
        type: 'usage',
        usage: measuredUsage,
        sessionId: this.lastSession?.sessionId ?? null,
      };
    } else {
      const contextTokens = estimateTokensForTexts([
        ...(conversationHistory ?? []).map((message) => message.content ?? ''),
        promptText,
        responseText,
      ]);
      yield {
        type: 'usage',
        usage: buildEstimatedUsageInfo({
          contextTokens,
          contextWindow,
          model: model || undefined,
        }),
        sessionId: this.lastSession?.sessionId ?? null,
      };
    }
    yield { type: 'done' };
  }

  cancel(): void {
    const proc = this.activeProcess;
    if (proc && proc.exitCode === null) {
      terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
    }
  }

  async softSteer(_turn: PreparedChatTurn): Promise<boolean> {
    this.cancel();
    return true;
  }

  resetSession(): void {
    this.lastSession = null;
  }

  getSessionId(): string | null {
    return this.lastSession?.sessionId ?? null;
  }

  consumeSessionInvalidation(): boolean {
    // Stateless runtime: nothing downstream depends on invalidation signals.
    return false;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  getAuxiliaryModel(): string | null {
    return null;
  }

  cleanup(): void {
    this.cancel();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    if (!this.lastSession) {
      return { updates: { providerState: undefined, sessionId: null } };
    }
    void params;
    return {
      updates: {
        providerState: buildPersistedDshState(this.lastSession),
        sessionId: this.lastSession.sessionId ?? null,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.lastSession?.sessionId ?? getDshState(conversation?.providerState).sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private formatError(message: string, stderr: string): string {
    const tail = stderr.trim().slice(-2000);
    return tail ? `${message}\n\n${tail}` : message;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }
}
