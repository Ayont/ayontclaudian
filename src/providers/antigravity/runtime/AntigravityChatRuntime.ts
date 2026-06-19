import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

import { expandProviderCommandInput } from '../../../core/providers/commands/expandProviderCommandInput';
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
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from '../capabilities';
import {
  discoverNewestConversationId,
  getAntigravityTranscriptPath,
  hasAntigravityTranscript,
  readAntigravityTranscript,
  snapshotBrainConversationIds,
  splitTranscriptLines,
} from '../history/AntigravityBrainStore';
import { parseTranscript } from '../normalization/transcript';
import {
  type AntigravityTailState,
  createAntigravityTailState,
  mapTranscriptEventToChunks,
} from '../normalization/transcriptMapping';
import { ANTIGRAVITY_PROVIDER_ID, getAntigravityProviderSettings } from '../settings';
import {
  type AntigravityProviderState,
  buildPersistedAntigravityState,
  getAntigravityState,
} from '../types';
import { buildAntigravityLaunchSpec } from './AntigravityLaunchSpec';
import { buildAntigravityRuntimeEnv } from './AntigravityRuntimeEnvironment';

const TRANSCRIPT_POLL_INTERVAL_MS = 120;
const POST_EXIT_SETTLE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Single-shot subprocess runtime for the Antigravity (`agy`) CLI.
 *
 * Unlike the long-lived RPC providers (pi, opencode), each turn spawns
 * `agy --print …`, tails the per-conversation transcript.jsonl for structured
 * events while the process runs, and resolves the final assistant text from
 * stdout. Conversation continuity is achieved with `--conversation <id>`,
 * where the id is discovered from the newest `brain/<id>` directory after the
 * first spawn and persisted in provider state.
 */
export class AntigravityChatRuntime implements ChatRuntime {
  readonly providerId = ANTIGRAVITY_PROVIDER_ID;

  private conversationId: string | null = null;
  /** Set while re-running a turn after clearing a dead conversation (see query()). */
  private isResumeRetry = false;
  private transcriptPath: string | null = null;
  private sessionInvalidated = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return ANTIGRAVITY_PROVIDER_CAPABILITIES;
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
      this.conversationId = null;
      this.transcriptPath = null;
      this.sessionInvalidated = false;
      return;
    }

    const state = getAntigravityState(conversation.providerState);
    // Prefer Antigravity's own stored conversation id. Only fall back to the
    // shared `conversation.sessionId` when it is actually an Antigravity brain
    // conversation (a transcript exists on disk) — after switching providers in
    // the same chat that shared field can hold another provider's session id
    // (e.g. a Kimi `ses_…`), which agy would reject with "conversation not
    // found". An unrecognized id is dropped so agy starts a fresh conversation.
    const sharedId = conversation.sessionId;
    const legacyId = sharedId && hasAntigravityTranscript(sharedId) ? sharedId : null;
    this.conversationId = state.conversationId ?? legacyId;
    this.transcriptPath = state.transcriptPath
      ?? (this.conversationId ? getAntigravityTranscriptPath(this.conversationId) : null);
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getAntigravityProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const resolved = this.plugin.getResolvedProviderCliPath(ANTIGRAVITY_PROVIDER_ID);
    this.setReady(Boolean(resolved));
    return Boolean(resolved);
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    this.cancelled = false;

    // See VibeChatRuntime: a single fresh re-run after a dead-conversation recovery.
    const isRetry = this.isResumeRetry;
    this.isResumeRetry = false;
    const hadSession = this.conversationId !== null;

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getAntigravityProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Antigravity is disabled. Enable it in settings.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(ANTIGRAVITY_PROVIDER_ID);
    if (!command) {
      yield {
        type: 'error',
        content: 'Could not find the `agy` binary. Set the CLI path in Antigravity settings.',
      };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildAntigravityRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, ANTIGRAVITY_PROVIDER_ID);
    // Expand a chosen vault command/skill client-side — agy print mode can't
    // expand `/command` or `$skill` tokens itself. Unknown input and ordinary
    // prompts pass through unchanged. Best-effort: any catalog error falls back.
    let prompt = this.buildPromptText(turn);
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(ANTIGRAVITY_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        prompt = expandProviderCommandInput(prompt, entries);
      }
    } catch {
      // Keep the unexpanded prompt on any catalog failure.
    }

    const previousBrainIds = this.conversationId ? null : snapshotBrainConversationIds();
    // Capture how much transcript already exists BEFORE spawning. agy appends
    // this turn's events to the same transcript.jsonl on `--conversation <id>`;
    // starting the tail past the prior lines keeps the new bubble from
    // re-emitting the entire conversation history (duplicated messages).
    const priorTranscriptLineCount = this.conversationId
      ? splitTranscriptLines(readAntigravityTranscript(this.conversationId) ?? '').length
      : 0;
    const launchSpec = buildAntigravityLaunchSpec({
      command,
      conversationId: this.conversationId,
      cwd,
      env,
      envText,
      prompt,
      permissionMode: settings.permissionMode,
      printTimeout: settings.printTimeout,
      workspaceScope: settings.workspaceScope,
      homeDir: os.homedir(),
    });

    if (!isRetry) {
      yield { type: 'user_message_start', content: turn.request.text };
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
        content: error instanceof Error ? error.message : 'Failed to launch agy.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    // `agy` blocks reading stdin until EOF under a non-TTY child process (the
    // open `stdio: 'pipe'` stdin never closes on its own), so the turn would
    // hang forever and write no transcript. Close the write end immediately.
    proc.stdin.end();
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const exitPromise = new Promise<{ code: number | null; error?: Error }>((resolve) => {
      proc.on('error', (error) => resolve({ code: null, error }));
      proc.on('exit', (code) => resolve({ code }));
    });

    // If resuming a known conversation, start tailing its transcript right away.
    // Otherwise discover the id once the brain directory appears.
    const tailState: AntigravityTailState = createAntigravityTailState();
    let tailCursor = priorTranscriptLineCount;
    let emittedAnyTextFromTranscript = false;
    let responseText = '';

    const accumulateResponse = (chunk: StreamChunk): void => {
      if ((chunk.type === 'text' || chunk.type === 'thinking') && typeof chunk.content === 'string') {
        responseText += chunk.content;
      }
    };

    // Estimated context-window usage from history + this turn's prompt/response.
    // agy reports no token counts, so this is a heuristic (≈4 chars/token).
    const buildUsageChunk = (): StreamChunk => ({
      type: 'usage',
      usage: buildEstimatedUsageInfo({
        contextTokens: estimateTokensForTexts([
          ...(conversationHistory ?? []).map((message) => message.content ?? ''),
          prompt,
          responseText,
        ]),
        contextWindow: 1_000_000,
      }),
      sessionId: this.conversationId,
    });
    let lastUsageLen = -1;

    const drainTranscript = (): StreamChunk[] => {
      if (!this.conversationId && previousBrainIds) {
        const discovered = discoverNewestConversationId(previousBrainIds);
        if (discovered) {
          this.conversationId = discovered;
          this.transcriptPath = getAntigravityTranscriptPath(discovered);
        }
      }
      if (!this.conversationId) {
        return [];
      }
      const buffer = readAntigravityTranscript(this.conversationId);
      if (buffer === null) {
        return [];
      }
      const lines = splitTranscriptLines(buffer);
      if (tailCursor > lines.length) {
        tailCursor = 0;
      }
      if (tailCursor >= lines.length) {
        return [];
      }
      const newLines = lines.slice(tailCursor);
      tailCursor = lines.length;
      const chunks: StreamChunk[] = [];
      for (const event of parseTranscript(newLines.join('\n'))) {
        const mapped = mapTranscriptEventToChunks(event, tailState);
        for (const chunk of mapped) {
          if (chunk.type === 'text') {
            emittedAnyTextFromTranscript = true;
          }
          chunks.push(chunk);
        }
      }
      return chunks;
    };

    try {
      let exited: { code: number | null; error?: Error } | null = null;
      while (!exited) {
        const settled = await Promise.race([
          exitPromise.then((value) => ({ done: true as const, value })),
          sleep(TRANSCRIPT_POLL_INTERVAL_MS).then(() => ({ done: false as const })),
        ]);
        for (const chunk of drainTranscript()) {
          accumulateResponse(chunk);
          yield chunk;
        }
        // Live context meter: emit an updated estimate when the response grew.
        if (responseText.length !== lastUsageLen) {
          lastUsageLen = responseText.length;
          yield buildUsageChunk();
        }
        if (settled.done) {
          exited = settled.value;
        }
        if (this.cancelled) {
          break;
        }
      }

      // Settle: let agy finish writing the transcript, then drain the remainder.
      await sleep(POST_EXIT_SETTLE_MS);
      for (const chunk of drainTranscript()) {
        accumulateResponse(chunk);
        yield chunk;
      }

      this.persistDiscoveredConversation();

      // Dead OWN conversation → clear it and retry the turn fresh (no error card).
      if (
        !isRetry &&
        isStaleResumeFailure({
          hadSession,
          exitCode: exited?.code ?? null,
          stderr,
          producedOutput: responseText.trim().length > 0,
        })
      ) {
        this.resetSession();
        this.isResumeRetry = true;
        yield { type: 'notice', content: staleSessionRetryNotice('Antigravity'), level: 'info' };
        if (this.activeProcess === proc) {
          this.activeProcess = null;
        }
        yield* this.query(turn, conversationHistory, _queryOptions);
        return;
      }

      if (exited?.error) {
        yield { type: 'error', content: this.formatError(exited.error.message, stderr) };
        yield { type: 'done' };
        return;
      }

      if (exited && exited.code !== 0 && exited.code !== null) {
        yield {
          type: 'error',
          content: this.formatError(`agy exited with code ${exited.code}`, stderr),
        };
        yield { type: 'done' };
        return;
      }

      // Fall back to stdout when no assistant text was recovered from the transcript.
      if (!emittedAnyTextFromTranscript) {
        const text = stdout.trim();
        if (text) {
          responseText += text;
          yield { type: 'text', content: text };
        }
      }

      this.currentTurnMetadata.wasSent = true;
      // Final context-window estimate (includes the stdout fallback text).
      yield buildUsageChunk();
      yield { type: 'done' };
    } finally {
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }
  }

  cancel(): void {
    this.cancelled = true;
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
    this.sessionInvalidated = true;
    this.conversationId = null;
    this.transcriptPath = null;
  }

  getSessionId(): string | null {
    return this.conversationId;
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
    if (params.sessionInvalidated && !this.conversationId) {
      return { updates: { providerState: undefined, sessionId: null } };
    }

    const state: AntigravityProviderState = {
      ...(this.conversationId ? { conversationId: this.conversationId } : {}),
      ...(this.transcriptPath ? { transcriptPath: this.transcriptPath } : {}),
    };
    return {
      updates: {
        providerState: buildPersistedAntigravityState(state),
        sessionId: this.conversationId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    if (this.conversationId) {
      return this.conversationId;
    }
    const stateId = getAntigravityState(conversation?.providerState).conversationId;
    if (stateId) {
      return stateId;
    }
    // Only trust the shared session id when it is a real Antigravity brain
    // conversation; otherwise it may be another provider's id.
    const shared = conversation?.sessionId;
    return shared && hasAntigravityTranscript(shared) ? shared : null;
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

  private persistDiscoveredConversation(): void {
    if (this.conversationId && !this.transcriptPath) {
      this.transcriptPath = getAntigravityTranscriptPath(this.conversationId);
    }
  }

  private buildPromptText(turn: PreparedChatTurn): string {
    // agy is a self-contained agent: it ships its own system prompt, tool set,
    // and per-workspace memory, and resumes prior context itself via
    // `--conversation <id>`. Injecting Claudian's full main-agent system prompt
    // here made agy treat every first turn as a large task — it would spin for
    // minutes (indexing + agentic exploration) before writing any transcript,
    // so the chat showed only the spinner. Send just the user's message and let
    // agy behave as it does in its own CLI.
    return turn.request.text;
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
