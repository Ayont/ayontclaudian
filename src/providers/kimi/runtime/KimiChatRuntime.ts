import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderCapabilities } from '../../../core/providers/types';
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
import { KIMI_PROVIDER_CAPABILITIES } from '../capabilities';
import { resolveKimiModelSelection } from '../modelOptions';
import { parseKimiStreamLine } from '../normalization/streamEvents';
import {
  createKimiStreamState,
  type KimiStreamState,
  mapKimiEventToChunks,
} from '../normalization/streamMapping';
import { getKimiProviderSettings, KIMI_PROVIDER_ID } from '../settings';
import { buildPersistedKimiState, getKimiState, type KimiProviderState } from '../types';
import { buildKimiLaunchSpec } from './KimiLaunchSpec';
import { buildKimiRuntimeEnv } from './KimiRuntimeEnvironment';

// stderr prints a resume hint after each run, e.g. `kimi -r <session-id>`.
const SESSION_HINT_PATTERN = /kimi(?:-cli)?\s+-r\s+([^\s]+)/i;
const SESSION_HINT_PATTERN_ALT = /resume this session:\s*kimi(?:-cli)?\s+-r\s+([^\s]+)/i;

/**
 * Single-turn subprocess runtime for the Kimi (`kimi-cli`) CLI.
 *
 * Each turn spawns `kimi-cli --print --output-format stream-json …` and parses
 * the stdout JSON lines LIVE (one complete chat message per line) into
 * `StreamChunk`s. Conversation continuity uses native resume: the session id is
 * recovered from the stderr resume hint after the first run and replayed via
 * `--session <id>`. Unlike antigravity there is no transcript-file tail.
 */
export class KimiChatRuntime implements ChatRuntime {
  readonly providerId = KIMI_PROVIDER_ID;

  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return KIMI_PROVIDER_CAPABILITIES;
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
    const state = getKimiState(conversation.providerState);
    this.sessionId = state.sessionId ?? conversation.sessionId ?? null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getKimiProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }
    const resolved = this.plugin.getResolvedProviderCliPath(KIMI_PROVIDER_ID);
    this.setReady(Boolean(resolved));
    return Boolean(resolved);
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    this.cancelled = false;

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getKimiProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Kimi is disabled. Enable it in settings.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(KIMI_PROVIDER_ID);
    if (!command) {
      yield {
        type: 'error',
        content: 'Could not find the `kimi-cli` binary. Set the CLI path in Kimi settings.',
      };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildKimiRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, KIMI_PROVIDER_ID);
    const model = queryOptions?.model?.trim()
      || resolveKimiModelSelection(settingsBag, typeof settingsBag.model === 'string' ? settingsBag.model : '')
      || '';

    const launchSpec = buildKimiLaunchSpec({
      agent: settings.agent,
      agentFile: settings.agentFile,
      command,
      cwd,
      env,
      envText,
      mcpConfigFile: settings.mcpConfigFile,
      model,
      permissionMode: settings.permissionMode,
      prompt: turn.request.text,
      // Never `--continue` on a fresh chat: that resumes the most recent
      // kimi-cli session for this cwd (e.g. an unrelated terminal session or a
      // prior chat) and bleeds its context in. Resume only via an explicit
      // `--session <id>` once this conversation already owns one.
      sessionId: this.sessionId,
      thinking: settings.thinkingDefault,
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
        content: error instanceof Error ? error.message : 'Failed to launch kimi-cli.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    // Close stdin so a non-TTY child process can't block on the open pipe;
    // `kimi-cli` print mode never reads stdin.
    proc.stdin.end();
    const streamState = createKimiStreamState();
    let stdoutBuffer = '';
    let stderr = '';
    const pendingChunks: StreamChunk[] = [];
    let toolResultIndex = 0;

    const drainCompleteLines = (): void => {
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        this.consumeLine(line, streamState, pendingChunks, () => toolResultIndex++);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      drainCompleteLines();
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const exitPromise = new Promise<{ code: number | null; error?: Error }>((resolve) => {
      proc.on('error', (error) => resolve({ code: null, error }));
      proc.on('close', (code) => resolve({ code }));
    });

    try {
      const exited = await exitPromise;

      // Flush any trailing partial line that arrived without a newline.
      if (stdoutBuffer.trim()) {
        this.consumeLine(stdoutBuffer, streamState, pendingChunks, () => toolResultIndex++);
        stdoutBuffer = '';
      }

      for (const chunk of pendingChunks) {
        yield chunk;
      }
      pendingChunks.length = 0;

      this.recoverSessionId(stderr);

      if (exited.error) {
        yield { type: 'error', content: this.formatError(exited.error.message, stderr) };
        yield { type: 'done' };
        return;
      }

      if (exited.code !== 0 && exited.code !== null) {
        yield {
          type: 'error',
          content: this.formatError(`kimi-cli exited with code ${exited.code}`, stderr),
        };
        yield { type: 'done' };
        return;
      }

      this.currentTurnMetadata.wasSent = true;
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
    const state: KimiProviderState = {
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    return {
      updates: {
        providerState: buildPersistedKimiState(state),
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return (
      this.sessionId
      ?? getKimiState(conversation?.providerState).sessionId
      ?? conversation?.sessionId
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
    streamState: KimiStreamState,
    sink: StreamChunk[],
    nextIndex: () => number,
  ): void {
    const event = parseKimiStreamLine(line);
    if (!event) {
      return;
    }
    const sessionFromEvent = event.raw.session_id;
    if (typeof sessionFromEvent === 'string' && sessionFromEvent.trim()) {
      this.sessionId = sessionFromEvent.trim();
    }
    const chunks = mapKimiEventToChunks(event, streamState, event.role === 'tool' ? nextIndex() : 0);
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
