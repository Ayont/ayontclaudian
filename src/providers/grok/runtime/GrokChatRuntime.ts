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
import { GROK_PROVIDER_CAPABILITIES } from '../capabilities';
import { getGrokModelContextWindow, resolveGrokModelSelection } from '../modelOptions';
import { parseGrokStreamLine } from '../normalization/streamEvents';
import {
  createGrokStreamState,
  type GrokStreamState,
  mapGrokEventToChunks,
} from '../normalization/streamMapping';
import { getGrokProviderSettings, GROK_PROVIDER_ID } from '../settings';
import { buildPersistedGrokState, getGrokState, type GrokProviderState } from '../types';
import { buildGrokLaunchSpec } from './GrokLaunchSpec';
import { buildGrokRuntimeEnv } from './GrokRuntimeEnvironment';

// stderr prints a resume hint after each run, e.g. `grok -r <session-id>`.
const SESSION_HINT_PATTERN = /grok(?:-cli)?\s+-r\s+([^\s]+)/i;
const SESSION_HINT_PATTERN_ALT = /resume this session:\s*grok(?:-cli)?\s+-r\s+([^\s]+)/i;

/**
 * Single-turn subprocess runtime for the Grok (`grok-cli`) CLI.
 *
 * Each turn spawns `grok-cli --print --output-format stream-json …` and parses
 * the stdout JSON lines LIVE (one complete chat message per line) into
 * `StreamChunk`s. Conversation continuity uses native resume: the session id is
 * recovered from the stderr resume hint after the first run and replayed via
 * `--session <id>`. Unlike antigravity there is no transcript-file tail.
 */
export class GrokChatRuntime implements ChatRuntime {
  readonly providerId = GROK_PROVIDER_ID;

  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

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
      this.sessionInvalidated = false;
      return;
    }
    const state = getGrokState(conversation.providerState);
    // Only resume Grok's OWN session (providerState); never the shared
    // conversation.sessionId (would be another provider's id after a switch →
    // "no rollout / session not found"). No own session → start fresh.
    this.sessionId = state.sessionId ?? null;
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
        content: 'Could not find the `grok-cli` binary. Set the CLI path in Grok settings.',
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

    // Expand a chosen vault command/skill client-side — grok-cli print mode
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

    // Grok selects the model via the GROK_ACTIVE_MODEL env var, not a CLI flag.
    if (model) {
      env.GROK_ACTIVE_MODEL = model;
    }

    const launchSpec = buildGrokLaunchSpec({
      command,
      cwd,
      env,
      envText,
      model,
      permissionMode: settings.permissionMode,
      prompt: promptText,
      // Resume only via an explicit session id once this conversation owns one;
      // never auto-continue the most recent grok session (context bleed).
      sessionId: this.sessionId,
    });

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
        content: error instanceof Error ? error.message : 'Failed to launch grok-cli.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    // Close stdin so a non-TTY child process can't block on the open pipe;
    // `grok-cli` print mode never reads stdin.
    proc.stdin.end();
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

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      drainCompleteLines();
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const onExit = (info: { code: number | null; error?: Error }): void => {
      // Flush any trailing partial line that arrived without a newline.
      if (stdoutBuffer.trim()) {
        this.consumeLine(stdoutBuffer, streamState, pendingChunks, () => toolResultIndex++);
        stdoutBuffer = '';
      }
      exitInfo = info;
      finished = true;
      signal();
    };
    proc.on('error', (error) => onExit({ code: null, error }));
    proc.on('close', (code) => onExit({ code }));

    let responseText = '';
    try {
      // Drain all available chunks, then sleep until the next 'data'/'close'
      // wakes us. Single-threaded model guarantees no lost wakeup: chunks are
      // fully drained before `wake` is installed, and `close` always fires.
      while (true) {
        while (pendingChunks.length > 0) {
          const chunk = pendingChunks.shift() as StreamChunk;
          if ((chunk.type === 'text' || chunk.type === 'thinking') && typeof chunk.content === 'string') {
            responseText += chunk.content;
          }
          yield chunk;
        }
        if (finished) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      this.recoverSessionId(stderr);

      if (exitInfo.error) {
        yield { type: 'error', content: this.formatError(exitInfo.error.message, stderr) };
        yield { type: 'done' };
        return;
      }

      if (exitInfo.code !== 0 && exitInfo.code !== null) {
        yield {
          type: 'error',
          content: this.formatError(`grok-cli exited with code ${exitInfo.code}`, stderr),
        };
        yield { type: 'done' };
        return;
      }

      this.currentTurnMetadata.wasSent = true;
      // Estimated context-window feedback: grok-cli reports no token usage, so
      // approximate from the conversation history + this turn's prompt/response.
      const contextTokens = estimateTokensForTexts([
        ...(conversationHistory ?? []).map((message) => message.content ?? ''),
        promptText,
        responseText,
      ]);
      yield {
        type: 'usage',
        usage: buildEstimatedUsageInfo({
          contextTokens,
          contextWindow: getGrokModelContextWindow(model),
          model: model || undefined,
        }),
        sessionId: this.sessionId,
      };
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

  resetSession(): void {
    this.sessionInvalidated = true;
    this.sessionId = null;
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
        providerState: buildPersistedGrokState(state),
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
