import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import {
  buildGoalVerificationPrompt,
  type GoalVerdict,
  parseGoalVerdict,
} from '../../../core/conversation/goalLoop';
import { extractGoalFromPrompt } from '../../../core/conversation/goalPrompt';
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
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import {
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { CLINE_PROVIDER_CAPABILITIES } from '../capabilities';
import { clineSessionExists } from '../history/ClineSessionStore';
import { getClineModelContextWindow, resolveClineModelSelection } from '../modelOptions';
import { normalizeClineAcpToolName } from '../normalization/clineAcpToolNormalization';
import { parseClineJsonLine } from '../normalization/jsonEvents';
import { CLINE_PROVIDER_ID, getClineProviderSettings } from '../settings';
import { buildPersistedClineState, type ClineProviderState,getClineState, isClineNativeSessionId } from '../types';
import { ClineAuxQueryRunner } from './ClineAuxQueryRunner';
import {
  repairClineCompiledBinary,
  shouldRetryClineSignatureKill,
} from './ClineBinaryRepair';
import { runClineGoalLoop } from './ClineGoalLoop';
import { buildClineLaunchSpec } from './ClineLaunchSpec';
import { spawnClineProcess } from './ClineProcess';
import { buildClineRuntimeEnv } from './ClineRuntimeEnvironment';
import { buildClineTurnPrompt } from './ClineTurnPrompt';
import { CLINE_KEEPALIVE_INTERVAL_MS, CLINE_KEEPALIVE_MAX_SILENCE_MS } from './keepalive';

/**
 * Cline print runtime.
 *
 * `cline --acp` is not a stable transport on the shipped CLI (the Bun child
 * exits immediately with no JSON-RPC handshake). The documented headless path
 * is `cline --json`, which streams NDJSON and resumes via `--id`.
 */
export class ClineChatRuntime implements ChatRuntime {
  readonly providerId = CLINE_PROVIDER_ID;

  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private activeSpawnSpec: WindowsCmdShimSpawnSpec | null = null;
  private cancelled = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private isResumeRetry = false;
  private isSignatureRetry = false;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private sessionId: string | null = null;
  private sessionInvalidated = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return CLINE_PROVIDER_CAPABILITIES;
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
    const state = getClineState(conversation.providerState);
    const nativeId = isClineNativeSessionId(state.sessionId) ? state.sessionId : null;
    this.sessionId = nativeId && clineSessionExists(nativeId) ? nativeId : null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getClineProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    const command = this.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);
    const ready = settings.enabled && Boolean(command);
    this.setReady(ready);
    return ready;
  }

  /**
   * Entry point for a turn. When the conversation carries a standing `/goal` and
   * the goal loop is enabled, the turn becomes an autonomous loop that keeps
   * running until the objective is verifiably reached (see {@link runClineGoalLoop});
   * otherwise it is one plain CLI turn.
   */
  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const settings = getClineProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    const goal = settings.goalLoopEnabled
      ? extractGoalFromPrompt(turn.request.text)
      : null;

    if (!goal) {
      yield* this.runTurn(turn, conversationHistory, queryOptions);
      return;
    }

    this.cancelled = false;
    yield {
      type: 'notice',
      content: `🎯 Goal-Loop aktiv — bis zu ${settings.goalLoopMaxIterations} Durchläufe bis das Ziel erreicht ist.`,
      level: 'info',
    };
    yield* runClineGoalLoop({
      goal,
      initialPrompt: turn.request.text,
      deps: {
        runTurn: (prompt, options) =>
          this.runTurn(turn, conversationHistory, queryOptions, {
            echoUserMessage: options.echoUserMessage,
            promptOverride: prompt,
          }),
        verify: settings.goalLoopVerification === 'verifier'
          ? (goalText, work) => this.verifyGoalProgress(goalText, work, queryOptions?.model)
          : null,
        isCancelled: () => this.cancelled,
        maxIterations: settings.goalLoopMaxIterations,
      },
    });
  }

  /** Runs one Cline CLI turn end to end. */
  private async *runTurn(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
    overrides?: { echoUserMessage?: boolean; promptOverride?: string },
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    this.cancelled = false;
    const isRetry = this.isResumeRetry || this.isSignatureRetry;
    const isSignatureRetry = this.isSignatureRetry;
    this.isResumeRetry = false;
    this.isSignatureRetry = false;
    const hadSession = this.sessionId !== null;

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getClineProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Cline ist deaktiviert. Aktiviere es in den Einstellungen.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);
    if (!command) {
      yield {
        type: 'error',
        content: 'Die `cline`-Binary wurde nicht gefunden. CLI-Pfad in den Cline-Einstellungen setzen.',
      };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildClineRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, CLINE_PROVIDER_ID);
    const model = queryOptions?.model?.trim()
      || resolveClineModelSelection(
        settingsBag,
        typeof settingsBag.model === 'string' ? settingsBag.model : '',
      )
      || '';

    const requestedText = overrides?.promptOverride ?? turn.request.text;
    let promptText = requestedText;
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(CLINE_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        promptText = expandProviderCommandInput(requestedText, entries);
      }
    } catch {
      promptText = requestedText;
    }
    promptText = appendImagePathReferences(promptText, turn.request.images);

    const resumeId = this.sessionId && clineSessionExists(this.sessionId)
      ? this.sessionId
      : null;
    if (this.sessionId && !resumeId) {
      this.sessionId = null;
    }
    promptText = buildClineTurnPrompt({
      history: conversationHistory,
      prompt: promptText,
      sessionId: resumeId,
    });

    const launchSpec = buildClineLaunchSpec({
      apiProvider: settings.apiProvider,
      command,
      compaction: resumeId ? settings.compaction : 'basic',
      cwd,
      env,
      envText,
      mode: 'print',
      model,
      permissionMode: settings.permissionMode,
      prompt: promptText,
      retries: settings.retries,
      sessionId: resumeId,
      thinking: settings.thinking,
    });

    if (!isRetry && overrides?.echoUserMessage !== false) {
      yield { type: 'user_message_start', content: turn.request.text };
    }

    let proc: ChildProcessWithoutNullStreams;
    let resolvedSpawnSpec: WindowsCmdShimSpawnSpec;
    try {
      const spawned = spawnClineProcess({
        args: launchSpec.args,
        command: launchSpec.command,
        cwd,
        env,
      });
      proc = spawned.proc;
      resolvedSpawnSpec = spawned.spawnSpec;
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Cline konnte nicht gestartet werden.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    this.activeSpawnSpec = resolvedSpawnSpec;
    proc.stdin.end();

    let stdoutBuffer = '';
    let stderr = '';
    const pendingChunks: StreamChunk[] = [];
    let finished = false;
    let exitInfo: { code: number | null; error?: Error } = { code: null };
    let wake: (() => void) | null = null;
    let lastActivity = Date.now();
    let sawTextDelta = false;
    let reportedUsage: StreamChunk | null = null;
    const signal = (): void => {
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };

    const consumeLine = (line: string): void => {
      const event = parseClineJsonLine(line);
      if (!event) {
        return;
      }
      lastActivity = Date.now();
      if (isClineNativeSessionId(event.sessionId)) {
        this.sessionId = event.sessionId;
      }
      if (event.kind === 'error' && event.text) {
        pendingChunks.push({ type: 'error', content: event.text });
        return;
      }
      if (event.kind === 'usage') {
        if (event.text && !sawTextDelta) {
          pendingChunks.push({ type: 'text', content: event.text });
        }
        const inputTokens = event.usage?.inputTokens ?? 0;
        const cacheRead = event.usage?.cacheReadTokens ?? 0;
        const cacheWrite = event.usage?.cacheWriteTokens ?? 0;
        const contextTokens = inputTokens + cacheRead + cacheWrite;
        const contextWindow = getClineModelContextWindow(model);
        reportedUsage = {
          type: 'usage',
          sessionId: this.sessionId,
          usage: {
            inputTokens,
            outputTokens: event.usage?.outputTokens ?? 0,
            cacheReadInputTokens: cacheRead,
            cacheCreationInputTokens: cacheWrite,
            contextTokens,
            contextWindow,
            contextWindowIsAuthoritative: true,
            percentage: contextWindow > 0
              ? Math.min(100, Math.max(0, Math.round((contextTokens / contextWindow) * 100)))
              : 0,
            model: model || undefined,
          },
        };
        return;
      }
      if (event.kind === 'text' && event.text) {
        if (event.isFinal && sawTextDelta) {
          return;
        }
        if (!event.isFinal) {
          sawTextDelta = true;
        }
        pendingChunks.push({ type: 'text', content: event.text });
        return;
      }
      if (event.kind === 'thinking' && event.text) {
        pendingChunks.push({ type: 'thinking', content: event.text });
        return;
      }
      if (event.kind === 'tool_start') {
        pendingChunks.push({
          type: 'tool_use',
          id: event.toolCallId ?? `cline-tool-${Date.now()}`,
          name: normalizeClineAcpToolName(event.toolName),
          input: event.toolInput ?? {},
        });
        return;
      }
      if (event.kind === 'tool_end') {
        pendingChunks.push({
          type: 'tool_result',
          id: event.toolCallId ?? `cline-tool-${Date.now()}`,
          content: event.toolError ?? event.toolOutput ?? '',
          isError: Boolean(event.toolError),
        });
      }
    };

    const drainCompleteLines = (): void => {
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        consumeLine(line);
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
      if (stdoutBuffer.trim()) {
        consumeLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      exitInfo = info;
      finished = true;
      signal();
    };
    proc.on('error', (error) => onExit({ code: null, error }));
    proc.on('close', (code) => onExit({ code }));

    const keepaliveTimer = window.setInterval(() => {
      if (finished || this.cancelled) {
        return;
      }
      if (Date.now() - lastActivity > CLINE_KEEPALIVE_MAX_SILENCE_MS) {
        return;
      }
      pendingChunks.push({ type: 'keepalive' });
      signal();
    }, CLINE_KEEPALIVE_INTERVAL_MS);

    const firstEventTimer = window.setTimeout(() => {
      if (finished || this.cancelled || sawTextDelta || this.sessionId) {
        return;
      }
      const tail = stderr.trim();
      if (/unquoted prompt|not authenticated|invalid model/i.test(tail)) {
        pendingChunks.push({
          type: 'error',
          content: this.formatError('Cline hat den Turn abgelehnt.', tail),
        });
        terminateSpawnedProcess(proc, 'SIGTERM', spawn, resolvedSpawnSpec);
        signal();
        return;
      }
      pendingChunks.push({
        type: 'notice',
        content: tail
          ? this.formatError('Cline startet noch. Warte auf das erste Event.', tail)
          : 'Cline startet noch — der erste Token kann bei höherem Thinking etwas dauern.',
        level: 'info',
      });
      signal();
    }, 12_000);

    let responseText = '';
    try {
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

      if (
        !isRetry
        && isStaleResumeFailure({
          hadSession,
          exitCode: exitInfo.code,
          stderr,
          producedOutput: responseText.trim().length > 0,
        })
      ) {
        this.resetSession();
        this.isResumeRetry = true;
        yield { type: 'notice', content: staleSessionRetryNotice('Cline'), level: 'info' };
        if (this.activeProcess === proc) {
          this.activeProcess = null;
          this.activeSpawnSpec = null;
        }
        yield* this.runTurn(turn, conversationHistory, queryOptions, overrides);
        return;
      }

      if (this.cancelled) {
        yield { type: 'done' };
        return;
      }

      if (exitInfo.error) {
        yield { type: 'error', content: this.formatError(exitInfo.error.message, stderr) };
        yield { type: 'done' };
        return;
      }

      if (exitInfo.code !== 0 && exitInfo.code !== null) {
        yield {
          type: 'error',
          content: this.formatError(`cline beendete mit Code ${exitInfo.code}`, stderr),
        };
        yield { type: 'done' };
        return;
      }

      if (exitInfo.code === null && !responseText.trim()) {
        if (shouldRetryClineSignatureKill({
          alreadyRetried: isSignatureRetry,
          cancelled: this.cancelled,
          exitCode: exitInfo.code,
          producedOutput: false,
        })) {
          const repair = repairClineCompiledBinary(command, { force: true });
          this.isSignatureRetry = true;
          yield {
            type: 'notice',
            level: 'info',
            content: repair.repaired
              ? 'Cline-Signatur war ungültig. Binary wurde neu signiert — starte den Turn erneut.'
              : 'Cline wurde ohne Antwort beendet. Versuche den Turn nach einer Signatur-Reparatur erneut.',
          };
          if (this.activeProcess === proc) {
            this.activeProcess = null;
            this.activeSpawnSpec = null;
          }
          yield* this.runTurn(turn, conversationHistory, queryOptions, overrides);
          return;
        }
        yield {
          type: 'error',
          content: this.formatError(
            'Cline wurde beendet, bevor eine Antwort kam. macOS hat die CLI erneut wegen einer ungültigen Signatur beendet. In den Cline-Einstellungen „Cline-CLI prüfen“ drücken und den Turn erneut senden.',
            stderr,
          ),
        };
        yield { type: 'done' };
        return;
      }

      this.currentTurnMetadata.wasSent = true;
      if (reportedUsage) {
        yield reportedUsage;
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
            contextWindow: getClineModelContextWindow(model),
            model: model || undefined,
          }),
          sessionId: this.sessionId,
        };
      }
      yield { type: 'done' };
    } finally {
      window.clearInterval(keepaliveTimer);
      window.clearTimeout(firstEventTimer);
      if (this.activeProcess === proc) {
        this.activeProcess = null;
        this.activeSpawnSpec = null;
      }
    }
  }

  steer?(_turn: PreparedChatTurn): Promise<boolean> {
    return Promise.resolve(false);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.activeProcess) {
      terminateSpawnedProcess(this.activeProcess, 'SIGTERM', spawn, this.activeSpawnSpec);
      this.activeProcess = null;
      this.activeSpawnSpec = null;
    }
  }

  resetSession(): void {
    this.sessionId = null;
    this.sessionInvalidated = false;
    this.isSignatureRetry = false;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const wasInvalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return wasInvalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  getAuxiliaryModel?(): string | null {
    return null;
  }

  cleanup(): void {
    this.cancel();
    this.setReady(false);
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Rewind wird von Cline nicht unterstützt.' };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(_callback: ((mode: string) => void) | null): void {}

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
    const state: ClineProviderState = {
      sessionId: this.sessionId ?? undefined,
    };
    if (params.sessionInvalidated) {
      state.sessionId = undefined;
    }
    return {
      updates: {
        providerState: buildPersistedClineState(state),
        sessionId: isClineNativeSessionId(this.sessionId) ? this.sessionId : null,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? getClineState(conversation?.providerState).sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  /**
   * Second opinion for the goal loop: a short, thinking-free Cline call that
   * judges the accumulated work against the goal and answers with a JSON verdict.
   * Returns null when the verifier is unavailable or its answer is unusable — the
   * loop then falls back to the agent's own completion marker.
   */
  private async verifyGoalProgress(
    goal: string,
    work: string,
    model?: string,
  ): Promise<GoalVerdict | null> {
    const runner = new ClineAuxQueryRunner(this.plugin);
    try {
      const raw = await runner.query(
        {
          model,
          systemPrompt: 'Du bist ein strenger Prüfer und antwortest ausschließlich mit JSON.',
        },
        buildGoalVerificationPrompt(goal, work),
      );
      return parseGoalVerdict(raw);
    } catch {
      return null;
    } finally {
      runner.reset();
    }
  }

  private formatError(message: string, stderr: string): string {
    const tail = stderr.trim().split('\n').slice(-6).join('\n').trim();
    return tail ? `${message}\n${tail}` : message;
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
