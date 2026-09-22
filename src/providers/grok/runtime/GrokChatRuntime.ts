import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { buildPrintRetryPromptWithHistory } from '../../../core/conversation/printRetryHistory';
import { expandProviderCommandInput } from '../../../core/providers/commands/expandProviderCommandInput';
import { appendImagePathReferences } from '../../../core/providers/imagePathFallback';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
import { buildEstimatedUsageInfo, estimateTokensForTexts } from '../../../core/providers/usage/estimateUsage';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import { isStaleResumeFailure, staleSessionRetryNotice } from '../../../core/runtime/printSessionRecovery';
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
  UsageInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { resolveGrokBotName } from '../agents/resolveGrokBotName';
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { getGrokModelContextWindow, resolveGrokModelSelection } from '../modelOptions';
import { parseGrokStreamLine } from '../normalization/streamEvents';
import {
  createGrokStreamState,
  type GrokStreamState,
  mapGrokEventToChunks,
} from '../normalization/streamMapping';
import { buildGrokUsageInfo, isGrokContextLimitStop, readGrokReportedUsage } from '../normalization/usage';
import { getGrokProviderSettings, GROK_PROVIDER_ID } from '../settings';
import { buildPersistedGrokState, getGrokState, type GrokProviderState } from '../types';
import {
  GROK_DEFAULT_REASONING_EFFORT,
  normalizeGrokReasoningEffort,
} from '../types/models';
import { buildGrokLaunchSpec } from './GrokLaunchSpec';
import { buildGrokRuntimeEnv } from './GrokRuntimeEnvironment';

// stderr prints a resume hint after each run, e.g. `grok -r <session-id>`.
const SESSION_HINT_PATTERN = /grok(?:-cli)?\s+-r\s+([^\s]+)/i;
const SESSION_HINT_PATTERN_ALT = /resume this session:\s*grok(?:-cli)?\s+-r\s+([^\s]+)/i;

function resolveGrokTurnEffort(settingsBag: Record<string, unknown>, model: string): string {
  const live = typeof settingsBag.effortLevel === 'string' ? settingsBag.effortLevel : '';
  const fromLive = normalizeGrokReasoningEffort(live, model);
  if (fromLive) {
    return fromLive;
  }
  const legacy = getGrokProviderSettings(settingsBag).thinkingDefault
    ? GROK_DEFAULT_REASONING_EFFORT
    : 'low';
  return normalizeGrokReasoningEffort(legacy, model) ?? GROK_DEFAULT_REASONING_EFFORT;
}

/**
 * Single-turn subprocess runtime for the Grok (`grok`) CLI.
 *
 * Each turn spawns `grok --output-format streaming-json -m <model>
 * --reasoning-effort <effort> …` and parses the stdout JSON lines live into
 * `StreamChunk`s. The context meter prefers the CLI's `usage` / `end`
 * ledger (and `modelUsage.contextWindow`) and falls back to a character
 * estimate only when that ledger is missing. Conversation continuity uses
 * native resume: the session id comes from the terminal `end` event and is
 * replayed via `-r <id>`.
 */
export class GrokChatRuntime implements ChatRuntime {
  readonly providerId = GROK_PROVIDER_ID;

  private sessionId: string | null = null;
  private sessionBotName: string | null = null;
  private sessionInvalidated = false;
  /** Set while re-running a turn after clearing a dead session (see query()). */
  private isResumeRetry = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;
  private stopActiveProcess: (() => void) | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return GROK_PROVIDER_CAPABILITIES;
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
    if (!conversation) {
      this.sessionId = null;
      this.sessionBotName = null;
      this.sessionInvalidated = false;
      return;
    }
    const state = getGrokState(conversation.providerState);
    // Only resume Grok's OWN session (providerState); never the shared
    // conversation.sessionId (would be another provider's id after a switch →
    // "no rollout / session not found"). No own session → start fresh.
    this.sessionId = state.sessionId ?? null;
    const botName = conversation.providerState?.botName;
    this.sessionBotName = typeof botName === 'string' ? botName.trim() || null : null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getGrokProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }
    const resolved = this.plugin.getResolvedProviderCliPath(GROK_PROVIDER_ID);
    this.setReady(Boolean(resolved));
    return Boolean(resolved);
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    this.cancelled = false;

    // See VibeChatRuntime: a single fresh re-run after a dead-session recovery.
    const isRetry = this.isResumeRetry;
    this.isResumeRetry = false;
    let hadSession = this.sessionId !== null;

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getGrokProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Grok is disabled. Enable it in settings.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(GROK_PROVIDER_ID);
    if (!command) {
      yield {
        type: 'error',
        content: 'Could not find the `grok` binary. Set the CLI path in Grok settings.',
      };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildGrokRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, GROK_PROVIDER_ID);
    const model = queryOptions?.model?.trim()
      || resolveGrokModelSelection(settingsBag, typeof settingsBag.model === 'string' ? settingsBag.model : '')
      || '';

    // Expand a chosen vault command/skill client-side — grok print mode
    // can't expand `/command` or `$skill` tokens itself. Unknown input and
    // ordinary prompts pass through unchanged. Best-effort: any catalog error
    // falls back to the raw text.
    let promptText = turn.request.text;
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(GROK_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        promptText = expandProviderCommandInput(turn.request.text, entries);
      }
    } catch {
      promptText = turn.request.text;
    }

    // Universal vision fallback: this CLI's plain-text prompt cannot carry
    // image blocks, but the staged image files on disk can be read by the
    // agent's file tools. Reference them so vision works here too.
    promptText = appendImagePathReferences(promptText, turn.request.images);

    if (isRetry) {
      promptText = buildPrintRetryPromptWithHistory({
        prompt: promptText,
        actualPrompt: turn.request.text,
        conversationHistory,
      });
    }

    // Grok selects the model via the GROK_ACTIVE_MODEL env var, not a CLI flag.
    if (model) {
      env.GROK_ACTIVE_MODEL = model;
    }

    let agentName: string | null;
    try {
      agentName = await resolveGrokBotName(settings.botName);
      if (settings.botName.trim() && !agentName) {
        throw new Error('Der ausgewählte Grok-Bot konnte nicht bestätigt werden. Bitte die Bot-Auswahl aktualisieren.');
      }
    } catch (error) {
      yield { type: 'error', content: error instanceof Error ? error.message : 'Grok-Bot konnte nicht geladen werden.' };
      yield { type: 'done' };
      return;
    }

    if (this.sessionId && this.sessionBotName !== agentName) {
      this.resetSession();
      hadSession = false;
    }
    this.sessionBotName = agentName;

    const launchSpec = buildGrokLaunchSpec({
      agentName,
      command,
      cwd,
      env,
      envText,
      model,
      permissionMode: settings.permissionMode,
      prompt: promptText,
      reasoningEffort: resolveGrokTurnEffort(settingsBag, model),
      // Resume only via an explicit session id once this conversation owns one;
      // never auto-continue the most recent grok session (context bleed).
      sessionId: this.sessionId,
    });

    if (!isRetry) {
      yield { type: 'user_message_start', content: turn.request.text };
    }

    if (this.cancelled) {
      yield { type: 'done' };
      return;
    }

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
        content: error instanceof Error ? error.message : 'Failed to launch grok.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;

    const streamState = createGrokStreamState();
    let stdoutBuffer = '';
    let stderr = '';
    const pendingChunks: StreamChunk[] = [];
    let toolResultIndex = 0;

    // Live pump: stdout 'data' events parse complete JSON lines into chunks and
    // wake the generator loop below, which yields each chunk to the chat UI the
    // moment it arrives. Previously all chunks were buffered and only yielded
    // after the process exited, so grok output appeared all at once at the end.
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

    const drainCompleteLines = (): void => {
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        this.consumeLine(line, streamState, pendingChunks, () => toolResultIndex++);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
      signal();
    };

    const onStdout = (chunk: Buffer | string): void => {
      if (finished || this.cancelled) return;
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      drainCompleteLines();
    };
    const onStderr = (chunk: Buffer | string): void => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    };
    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', onStderr);

    const onExit = (info: { code: number | null; error?: Error }): void => {
      if (finished) return;
      // Flush any trailing partial line that arrived without a newline.
      if (!this.cancelled && stdoutBuffer.trim()) {
        this.consumeLine(stdoutBuffer, streamState, pendingChunks, () => toolResultIndex++);
        stdoutBuffer = '';
      }
      exitInfo = info;
      finished = true;
      signal();
    };
    let closed = false;
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stopProcess = (): void => {
      signal();
      if (closed || stopping) return;
      stopping = true;
      terminateSpawnedProcess(proc, 'SIGTERM', spawn, resolvedSpawnSpec);
      // This watchdog owns a Node child, not a popout window.
      // eslint-disable-next-line obsidianmd/prefer-window-timers
      killTimer = setTimeout(() => {
        if (!closed) terminateSpawnedProcess(proc, 'SIGKILL', spawn, resolvedSpawnSpec);
      }, 2000);
      killTimer.unref?.();
    };
    this.stopActiveProcess = stopProcess;
    proc.once('error', (error) => onExit({ code: null, error }));
    proc.once('close', (code) => {
      closed = true;
      // eslint-disable-next-line obsidianmd/prefer-window-timers
      if (killTimer) clearTimeout(killTimer);
      onExit({ code });
    });

    let responseText = '';
    try {
      proc.stdin.end();
      // Drain all available chunks, then sleep until the next 'data'/'close'
      // wakes us. Single-threaded model guarantees no lost wakeup: chunks are
      // fully drained before `wake` is installed, and `close` always fires.
      while (!this.cancelled) {
        while (pendingChunks.length > 0 && !this.cancelled) {
          const chunk = pendingChunks.shift() as StreamChunk;
          if ((chunk.type === 'text' || chunk.type === 'thinking') && typeof chunk.content === 'string') {
            responseText += chunk.content;
          }
          yield chunk;
        }
        if (finished || this.cancelled) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      if (this.cancelled) {
        yield { type: 'done' };
        return;
      }

      this.recoverSessionId(stderr);

      // Dead OWN session → clear it and retry the turn fresh (no error card).
      if (
        !isRetry &&
        isStaleResumeFailure({
          hadSession,
          exitCode: exitInfo.code,
          stderr,
          producedOutput: responseText.trim().length > 0,
        })
      ) {
        this.resetSession();
        this.isResumeRetry = true;
        yield { type: 'notice', content: staleSessionRetryNotice('Grok'), level: 'info' };
        if (this.cancelled) {
          this.isResumeRetry = false;
          yield { type: 'done' };
          return;
        }
        if (this.activeProcess === proc) {
          this.activeProcess = null;
        }
        yield* this.query(turn, conversationHistory, queryOptions);
        return;
      }

      if (exitInfo.error) {
        yield { type: 'error', content: this.formatError(exitInfo.error.message, stderr) };
        yield { type: 'done' };
        return;
      }

      if (exitInfo.code !== 0) {
        if (!streamState.streamError) {
          yield {
            type: 'error',
            content: this.formatError(`grok exited with code ${exitInfo.code}`, stderr),
          };
        }
        yield { type: 'done' };
        return;
      }

      if (!responseText.trim()) {
        if (!streamState.streamError) {
          const contextWindow = getGrokModelContextWindow(model);
          yield {
            type: 'error',
            content: this.formatError(
              isGrokContextLimitStop(streamState.stopReason)
                ? `context window full (${contextWindow} tokens)`
                : 'Grok hat keine Antwort geliefert.',
              stderr,
            ),
          };
        }
        yield { type: 'done' };
        return;
      }

      this.currentTurnMetadata.wasSent = true;
      if (isGrokContextLimitStop(streamState.stopReason)) {
        const contextWindow = getGrokModelContextWindow(model);
        yield {
          type: 'notice',
          level: 'warning',
          content: `Kontextfenster voll (${contextWindow.toLocaleString('de-DE')} Tokens). Grok hat die Antwort am Limit beendet.`,
        };
      }
      yield {
        type: 'usage',
        usage: this.buildTurnUsage({
          conversationHistory,
          isRetry,
          model,
          promptText,
          responseText,
          usageRaw: streamState.usageRaw,
        }),
        sessionId: this.sessionId,
      };
      yield { type: 'done' };
    } finally {
      finished = true;
      proc.stdout.off('data', onStdout);
      proc.stderr.off('data', onStderr);
      stopProcess();
      if (this.stopActiveProcess === stopProcess) this.stopActiveProcess = null;
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.stopActiveProcess?.();
  }

  async softSteer(_turn: PreparedChatTurn): Promise<boolean> {
    this.cancel();
    return true;
  }

  resetSession(): void {
    this.sessionInvalidated = true;
    this.sessionId = null;
    this.sessionBotName = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
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
    if (params.sessionInvalidated && !this.sessionId) {
      return { updates: { providerState: undefined, sessionId: null } };
    }
    const state: GrokProviderState = {
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    return {
      updates: {
        providerState: this.sessionId
          ? { ...buildPersistedGrokState(state), botName: this.sessionBotName }
          : undefined,
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return (
      this.sessionId
      ?? getGrokState(conversation?.providerState).sessionId
      ?? null
    );
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

  private consumeLine(
    line: string,
    streamState: GrokStreamState,
    sink: StreamChunk[],
    _nextIndex: () => number,
  ): void {
    const event = parseGrokStreamLine(line);
    if (!event) {
      return;
    }
    const chunks = mapGrokEventToChunks(event, streamState);
    // The terminal `end` event carries the resume session id (captured into
    // streamState by the mapper); mirror it onto the runtime for `-r`.
    if (streamState.sessionId) {
      this.sessionId = streamState.sessionId;
    }
    for (const chunk of chunks) {
      sink.push(chunk);
    }
  }

  /**
   * Prefer the CLI's own ledger (`usage` / `end.modelUsage`). Fall back to a
   * character estimate only when that ledger is missing or all-zero.
   */
  private buildTurnUsage(params: {
    conversationHistory: ChatMessage[] | undefined;
    isRetry: boolean;
    model: string;
    promptText: string;
    responseText: string;
    usageRaw: Record<string, unknown> | null;
  }): UsageInfo {
    const reported = params.usageRaw
      ? readGrokReportedUsage(params.usageRaw, params.model)
      : null;
    if (reported) {
      return buildGrokUsageInfo({
        reported,
        fallbackContextWindow: getGrokModelContextWindow(params.model),
        model: params.model || undefined,
      });
    }

    const contextTokens = estimateTokensForTexts([
      ...(params.isRetry
        ? []
        : (params.conversationHistory ?? []).map((message) => message.content ?? '')),
      params.promptText,
      params.responseText,
    ]);
    return buildEstimatedUsageInfo({
      contextTokens,
      contextWindow: getGrokModelContextWindow(params.model),
      model: params.model || undefined,
      reportType: 'final',
    });
  }

  private recoverSessionId(stderr: string): void {
    if (this.sessionId) {
      return;
    }
    const match = stderr.match(SESSION_HINT_PATTERN_ALT) ?? stderr.match(SESSION_HINT_PATTERN);
    if (match && match[1]) {
      this.sessionId = match[1].trim();
    }
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

  private formatError(message: string, stderr: string): string {
    const trimmed = stderr.trim().slice(-2000);
    return trimmed ? `${message}\n\n${trimmed}` : message;
  }
}
