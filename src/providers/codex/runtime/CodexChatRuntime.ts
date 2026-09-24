import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities, ProviderId } from '../../../core/providers/types';
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
  NativeGoalAction,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  ForkSource,
  NativeGoalState,
  SlashCommand,
  StreamChunk,
  SubagentCancelTarget,
} from '../../../core/types';
import { normalizeWorkspaceMode } from '../../../core/workspace/workspaceMode';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { buildBoundedContextFromHistory } from '../../../utils/session';
import { CODEX_PROVIDER_CAPABILITIES } from '../capabilities';
import {
  deriveCodexMemoriesDirFromSessionsRoot,
  deriveCodexSessionsRootFromSessionPath,
  findCodexSessionFile,
} from '../history/CodexHistoryStore';
import { encodeCodexTurn } from '../prompt/encodeCodexTurn';
import {
  type CodexSafeMode,
  getCodexProviderSettings,
  getEffectiveCodexReasoningSummary,
} from '../settings';
import {
  extractExplicitCodexSkillNames,
  findPreferredCodexSkillByName,
} from '../skills/CodexSkillListingService';
import { type CodexProviderState, getCodexState } from '../types';
import { readCodexCatalogWindow } from '../types/codexModelCatalog';
import { DEFAULT_CODEX_PRIMARY_MODEL, resolveCodexLargeWindow, supportsCodexFastTier } from '../types/models';
import { CodexAppServerProcess } from './CodexAppServerProcess';
import {
  initializeCodexAppServerTransport,
  resolveCodexAppServerLaunchSpec,
} from './codexAppServerSupport';
import type {
  SandboxPolicy,
  ServerRequestResolvedNotification,
  SkillInput,
  SkillsListResult,
  ThreadCompactStartResult,
  ThreadForkParams,
  ThreadForkResult,
  ThreadResumeResult,
  ThreadStartResult,
  TurnInterruptParams,
  TurnStartedNotification,
  TurnStartResult,
  TurnSteerResult,
  UserInput,
} from './codexAppServerTypes';
import { CodexChildThreadRelay } from './CodexChildThreadRelay';
import {
  type CodexThreadGoal,
  isCodexThreadGoal,
  type ThreadGoalClearedNotification,
  type ThreadGoalSetResult,
  type ThreadGoalUpdatedNotification,
  toNativeGoalState,
} from './codexGoal';
import type { CodexLaunchSpec } from './codexLaunchTypes';
import { CodexNotificationRouter } from './CodexNotificationRouter';
import { CodexRpcTransport } from './CodexRpcTransport';
import { type CodexRuntimeContext, createCodexRuntimeContext } from './CodexRuntimeContext';
import { CodexServerRequestRouter } from './CodexServerRequestRouter';
import { CodexSessionManager } from './CodexSessionManager';

function resolveCodexSandboxConfig(
  permissionMode: string,
  codexSafeMode: CodexSafeMode = 'workspace-write',
): { approvalPolicy: string; sandbox: string } {
  if (permissionMode === 'yolo') {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }
  if (permissionMode === 'plan') {
    return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
  }
  // normal — resolve through the user's configured safe mode
  return { approvalPolicy: 'on-request', sandbox: codexSafeMode };
}

function resolveCodexServiceTier(serviceTier: unknown, model: string | undefined): string | null {
  if (!supportsCodexFastTier(model)) {
    return null;
  }
  return serviceTier === 'fast' ? 'fast' : null;
}

const EFFORT_MAP: Record<string, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
  ultra: 'ultra',
};

export class CodexChatRuntime implements ChatRuntime {
  readonly providerId: ProviderId = 'codex';

  private plugin: ClaudianPlugin;
  private session = new CodexSessionManager();
  private process: CodexAppServerProcess | null = null;
  private transport: CodexRpcTransport | null = null;
  private launchSpec: CodexLaunchSpec | null = null;
  private runtimeContext: CodexRuntimeContext | null = null;
  private notificationRouter: CodexNotificationRouter | null = null;
  private serverRequestRouter = new CodexServerRequestRouter();
  private ready = false;
  private readyListeners = new Set<(ready: boolean) => void>();
  private clientConfigKey: string | null = null;
  private currentTurnId: string | null = null;
  private currentQueryThreadId: string | null = null;
  private loadedThreadId: string | null = null;
  private currentThreadPath: string | null = null;
  private pendingTurnNotifications: Array<{ method: string; params: unknown }> = [];

  // Chunk buffer: notifications push here, query() drains
  private chunkBuffer: StreamChunk[] = [];
  private chunkResolve: (() => void) | null = null;
  // Set only while query() streams; child chunks outside a turn have no reader.
  private activeChunkSink: ((chunk: StreamChunk) => void) | null = null;
  private childRelay = new CodexChildThreadRelay((chunk) => this.activeChunkSink?.(chunk));

  private approvalCallback: ApprovalCallback | null = null;
  private approvalDismisser: (() => void) | null = null;
  private askUserCallback: AskUserQuestionCallback | null = null;
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private permissionModeSyncCallback: ((sdkMode: string) => void) | null = null;
  private subagentHookProvider: (() => SubagentRuntimeState) | null = null;
  private autoTurnCallback: AutoTurnCallback | null = null;
  private resumeCheckpoint: string | undefined;
  private activeInputBundles = new Set<CodexInputBundle>();

  // Fork state
  private pendingFork: ForkSource | null = null;

  // Cancellation
  private canceled = false;
  private turnMetadata: ChatTurnMetadata = {};

  /** How long a finished goal round waits for the server to start the next one. */
  static GOAL_CONTINUATION_GRACE_MS = 15_000;

  // Native goal (thread/goal/*): Codex itself starts the follow-up rounds.
  private nativeGoal: NativeGoalState | null = null;
  private goalRound = 0;
  /** Set when a round finished while the goal stays active: the next server turn joins this answer. */
  private goalHold: GoalHold | null = null;
  /**
   * Thread whose goal was set paused for this turn and is activated when its
   * first round ends. Active on an idle thread, Codex would start a turn of its
   * own, racing the one that carries this prompt.
   */
  private pendingGoalActivation: string | null = null;
  /** A pause or clear requested while the thread was not loaded; applied on the next query. */
  private pendingGoalCommand: 'pause' | 'clear' | null = null;
  private goalSyncedThreadId: string | null = null;

  constructor(plugin: ClaudianPlugin) {
    this.plugin = plugin;
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return CODEX_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return encodeCodexTurn(request);
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = { ...this.turnMetadata };
    this.turnMetadata = {};
    return metadata;
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(checkpointId: string | undefined): void {
    this.resumeCheckpoint = checkpointId;
  }

  syncConversationState(
    conversation: ChatRuntimeConversationState | null,
    _externalContextPaths?: string[],
  ): void {
    if (!conversation) {
      this.session.reset();
      this.loadedThreadId = null;
      this.currentThreadPath = null;
      this.pendingFork = null;
      this.childRelay.setParentThread(null);
      return;
    }

    const state = getCodexState(conversation.providerState);

    // Pending fork: store fork metadata, don't set the source thread as our session
    if (state.forkSource && !state.threadId && !conversation.sessionId) {
      this.pendingFork = state.forkSource;
      this.session.reset();
      this.loadedThreadId = null;
      this.currentThreadPath = null;
      this.childRelay.setParentThread(null);
      return;
    }

    this.pendingFork = null;
    const threadId = state.threadId ?? conversation.sessionId ?? null;

    if (!threadId) {
      this.session.reset();
      this.loadedThreadId = null;
      this.currentThreadPath = null;
      this.childRelay.setParentThread(null);
      return;
    }

    this.session.setThread(threadId, state.sessionFilePath);
    this.childRelay.setParentThread(threadId);
  }

  async reloadMcpServers(): Promise<void> {
    // No-op: Codex handles MCP internally
  }

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const promptSettings = this.getSystemPromptSettings();
    const promptKey = computeSystemPromptKey(promptSettings);
    const launchSpec = resolveCodexAppServerLaunchSpec(this.plugin, this.providerId);
    const clientConfigKey = [promptKey, JSON.stringify({
      command: launchSpec.command,
      args: launchSpec.args,
      spawnCwd: launchSpec.spawnCwd,
      targetCwd: launchSpec.targetCwd,
      target: launchSpec.target,
    })].join('::');
    const shouldRebuild = !this.process
      || !this.transport
      || !this.process.isAlive()
      || options?.force === true
      || this.clientConfigKey !== clientConfigKey;

    if (shouldRebuild) {
      await this.shutdownProcess();
      await this.startAppServer(launchSpec, clientConfigKey);
    }

    this.setReady(true);
    return shouldRebuild;
  }

  async *query(
    originalTurn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.resetTurnMetadata();
    let turn = originalTurn;
    await this.ensureReady();

    this.canceled = false;
    this.cleanupActiveInputBundles();
    this.chunkBuffer = [];
    this.chunkResolve = null;
    this.currentQueryThreadId = null;
    this.pendingTurnNotifications = [];

    const model = this.resolveModel(queryOptions);
    const promptSettings = this.getSystemPromptSettings();
    const promptText = buildSystemPrompt(promptSettings);

    const enqueueChunk = (chunk: StreamChunk): void => {
      this.chunkBuffer.push(chunk);
      if (this.chunkResolve) {
        this.chunkResolve();
        this.chunkResolve = null;
      }
    };

    // Set up notification router to push chunks
    this.notificationRouter = new CodexNotificationRouter(
      (chunk) => enqueueChunk(chunk),
      (update) => this.recordTurnMetadata(update),
      { describeChildThread: (threadId) => this.childRelay.describeChild(threadId) },
    );

    this.wireTransportHandlers();

    const compactValidationError = this.validateCompactTurn(originalTurn);
    if (compactValidationError) {
      yield { type: 'error', content: compactValidationError };
      yield { type: 'done' };
      return;
    }

    let keepaliveTimer: number | null = null;
    this.activeChunkSink = enqueueChunk;
    try {
      // Thread lifecycle
      const existingThreadId = this.session.getThreadId();
      let threadId: string;
      let threadPath: string | null = null;
      let threadTargetPath: string | null = null;
      let completedPendingFork = false;
      let historyReplayApplied = false;

      if (this.pendingFork) {
        // The app-server truncates the fork itself (`lastTurnId`, inclusive);
        // there is no `thread/rollback` to trim it afterwards.
        const fork = this.pendingFork;

        const forkParams: ThreadForkParams = { threadId: fork.sessionId, lastTurnId: fork.resumeAt };
        const forkResult = await this.transport!.request<ThreadForkResult>('thread/fork', forkParams);
        threadId = forkResult.thread.id;
        threadTargetPath = forkResult.thread.path ?? null;
        threadPath = this.toHostSessionPath(threadTargetPath);

        // Paginated threads may come back without turns; when they are present,
        // a fork that does not end at the checkpoint would carry later answers.
        const forkTurns = forkResult.thread.turns ?? [];
        if (forkTurns.length > 0 && forkTurns[forkTurns.length - 1].id !== fork.resumeAt) {
          throw new Error(`Fork checkpoint not found: ${fork.resumeAt}`);
        }

        // Resume the forked thread (required before turn/start)
        const permissionMode = this.resolveSandboxConfig();
        await this.transport!.request<ThreadResumeResult>('thread/resume', {
          threadId,
          model: model ?? DEFAULT_CODEX_PRIMARY_MODEL,
          approvalPolicy: permissionMode.approvalPolicy,
          sandbox: permissionMode.sandbox,
          serviceTier: resolveCodexServiceTier(this.getProviderSettings().serviceTier, model ?? DEFAULT_CODEX_PRIMARY_MODEL),
          baseInstructions: promptText,
          experimentalRawEvents: true,
          persistExtendedHistory: true,
          ...this.contextWindowConfig(model ?? DEFAULT_CODEX_PRIMARY_MODEL),
        });

        this.loadedThreadId = threadId;
        completedPendingFork = true;

        // Build replay suffix from conversation history after the checkpoint
        if (_conversationHistory && _conversationHistory.length > 0) {
          const checkpointIdx = _conversationHistory.findIndex(
            m => m.assistantMessageId === fork.resumeAt,
          );
          if (checkpointIdx >= 0 && checkpointIdx < _conversationHistory.length - 1) {
            const suffix = _conversationHistory.slice(checkpointIdx + 1);
            const replayContext = buildBoundedContextFromHistory(suffix);
            if (replayContext.trim()) {
              turn = {
                ...turn,
                prompt: `${replayContext}\n\nUser: ${turn.prompt}`,
              };
            }
          }
        }
      } else if (existingThreadId && existingThreadId !== this.loadedThreadId) {
        // Resume a persisted thread not yet loaded in this daemon
        const permissionMode = this.resolveSandboxConfig();
        const resumeRequest = {
          model: model ?? DEFAULT_CODEX_PRIMARY_MODEL,
          approvalPolicy: permissionMode.approvalPolicy,
          sandbox: permissionMode.sandbox,
          serviceTier: resolveCodexServiceTier(this.getProviderSettings().serviceTier, model ?? DEFAULT_CODEX_PRIMARY_MODEL),
          baseInstructions: promptText,
          experimentalRawEvents: true,
          persistExtendedHistory: true,
          ...this.contextWindowConfig(model ?? DEFAULT_CODEX_PRIMARY_MODEL),
        };
        try {
          const resumeResult = await this.transport!.request<ThreadResumeResult>('thread/resume', {
            threadId: existingThreadId,
            ...resumeRequest,
          });
          threadId = resumeResult.thread.id;
          threadTargetPath = resumeResult.thread.path ?? null;
        } catch {
          // The thread id may be stale or belong to another provider (after a
          // mid-chat provider switch) — codex then reports "no rollout found for
          // thread id …". Start a fresh codex thread instead of failing the turn.
          const startResult = await this.transport!.request<ThreadStartResult>('thread/start', {
            ...resumeRequest,
            cwd: this.launchSpec?.targetCwd ?? getVaultPath(this.plugin.app) ?? undefined,
          });
          threadId = startResult.thread.id;
          threadTargetPath = startResult.thread.path ?? null;
          turn = withBoundedHistoryReplay(turn, _conversationHistory);
          historyReplayApplied = turn !== originalTurn;
        }
        threadPath = this.toHostSessionPath(threadTargetPath);
        this.loadedThreadId = threadId;
      } else if (existingThreadId && existingThreadId === this.loadedThreadId) {
        // Thread already loaded — just start a new turn
        threadId = existingThreadId;
      } else {
        // New thread
        const permissionMode = this.resolveSandboxConfig();
        const startResult = await this.transport!.request<ThreadStartResult>('thread/start', {
          model: model ?? DEFAULT_CODEX_PRIMARY_MODEL,
          cwd: this.launchSpec?.targetCwd ?? getVaultPath(this.plugin.app) ?? undefined,
          approvalPolicy: permissionMode.approvalPolicy,
          sandbox: permissionMode.sandbox,
          serviceTier: resolveCodexServiceTier(this.getProviderSettings().serviceTier, model ?? DEFAULT_CODEX_PRIMARY_MODEL),
          baseInstructions: promptText,
          experimentalRawEvents: true,
          persistExtendedHistory: true,
          ...this.contextWindowConfig(model ?? DEFAULT_CODEX_PRIMARY_MODEL),
        });
        threadId = startResult.thread.id;
        threadTargetPath = startResult.thread.path ?? null;
        threadPath = this.toHostSessionPath(threadTargetPath);
        this.loadedThreadId = threadId;
        turn = withBoundedHistoryReplay(turn, _conversationHistory);
        historyReplayApplied = turn !== originalTurn;
      }

      // Update session with thread info
      this.session.setThread(threadId, threadPath ?? this.currentThreadPath ?? undefined);
      if (threadPath) this.currentThreadPath = threadPath;
      this.currentQueryThreadId = threadId;
      this.childRelay.setParentThread(threadId);
      if (completedPendingFork) {
        this.pendingFork = null;
      }

      await this.applyPendingGoalCommand(threadId);
      const goalAction = turn.isCompact ? null : (turn.request.nativeGoal ?? null);
      if (goalAction) {
        await this.armGoalAction(threadId, goalAction, enqueueChunk);
      } else {
        await this.syncNativeGoal(threadId, enqueueChunk);
      }

      if (turn.isCompact) {
        // --- Manual compact path: thread/compact/start ---
        this.notificationRouter?.beginTurn({ isPlanTurn: false });

        await this.transport!.request<ThreadCompactStartResult>(
          'thread/compact/start',
          { threadId },
        );
        this.recordTurnMetadata({ wasSent: true });
        // currentTurnId will be set by turn/started notification
      } else {
        // --- Normal turn path ---
        const sessionFilePathHint = threadPath ?? this.session.getSessionFilePath() ?? null;

        // Build input
        const skillInputs = await this.resolveSkillInputs(turn.request.text);
        let turnInputBundle = this.buildInput(turn.prompt, turn.request.images, skillInputs);
        this.registerActiveInputBundle(turnInputBundle);

        // Start turn
        const providerSettings = this.getProviderSettings();
        const effort = EFFORT_MAP[providerSettings.effortLevel as string] ?? 'medium';
        const resolvedModel = model ?? DEFAULT_CODEX_PRIMARY_MODEL;
        const isPlanMode = providerSettings.permissionMode === 'plan';
        const externalContextPaths = this.resolveExternalContextPaths(turn, queryOptions);
        const permissionMode = this.resolveSandboxConfig();
        const transcriptRootTarget = this.runtimeContext?.sessionsDirTarget
          ?? deriveCodexSessionsRootFromSessionPath(threadTargetPath)
          ?? this.resolveTranscriptRootTarget(sessionFilePathHint);
        let sandboxPolicy = this.buildTurnSandboxPolicy(
          externalContextPaths,
          permissionMode.sandbox,
          transcriptRootTarget,
          sessionFilePathHint,
        );

        const collaborationMode = {
          mode: isPlanMode ? 'plan' as const : 'default' as const,
          settings: {
            model: resolvedModel,
            reasoning_effort: effort,
            developer_instructions: null,
          },
        };

        const summary = getEffectiveCodexReasoningSummary(providerSettings, resolvedModel);
        const serviceTier = resolveCodexServiceTier(providerSettings.serviceTier, resolvedModel);

        // Configure router plan state before turn/start so buffered notifications
        // that arrive before currentTurnId is set already see the correct state.
        this.notificationRouter?.beginTurn({ isPlanTurn: isPlanMode });

        const startTurn = async (): Promise<TurnStartResult> => this.transport!.request<TurnStartResult>('turn/start', {
          threadId,
          input: turnInputBundle.input,
          approvalPolicy: permissionMode.approvalPolicy,
          model: resolvedModel,
          serviceTier,
          effort,
          summary,
          sandboxPolicy,
          collaborationMode,
        });

        let turnResult: TurnStartResult;
        try {
          turnResult = await startTurn();
        } catch (error) {
          if (!isCodexContextWindowError(error)) {
            throw error;
          }

          // Codex app-server can reject a long-running thread with:
          // "ran out of room in the model's context window". Instead of making
          // the user manually start a fresh chat, transparently drop only the
          // Codex-native thread state for this provider and retry the current
          // prompt in a fresh thread. The visible Claudian conversation remains.
          enqueueChunk({
            type: 'notice',
            level: 'warning',
            content: 'Codex context window was full, so Claudian started a fresh Codex thread and retried this message automatically.',
          });
          this.session.reset();
          this.loadedThreadId = null;
          this.currentThreadPath = null;

          const restart = await this.transport!.request<ThreadStartResult>('thread/start', {
            model: resolvedModel,
            cwd: this.launchSpec?.targetCwd ?? getVaultPath(this.plugin.app) ?? undefined,
            approvalPolicy: permissionMode.approvalPolicy,
            sandbox: permissionMode.sandbox,
            serviceTier,
            baseInstructions: promptText,
            experimentalRawEvents: true,
            persistExtendedHistory: true,
            ...this.contextWindowConfig(resolvedModel),
          });
          threadId = restart.thread.id;
          threadTargetPath = restart.thread.path ?? null;
          threadPath = this.toHostSessionPath(threadTargetPath);
          this.loadedThreadId = threadId;
          this.session.setThread(threadId, threadPath ?? undefined);
          if (threadPath) this.currentThreadPath = threadPath;
          this.currentQueryThreadId = threadId;
          this.childRelay.setParentThread(threadId);

          if (!historyReplayApplied) {
            const replayedTurn = withBoundedHistoryReplay(turn, _conversationHistory);
            if (replayedTurn !== turn) {
              turn = replayedTurn;
              historyReplayApplied = true;
              this.disposeInputBundle(turnInputBundle);
              turnInputBundle = this.buildInput(turn.prompt, turn.request.images, skillInputs);
              this.registerActiveInputBundle(turnInputBundle);
            }
          }

          const freshSessionFilePathHint = threadPath ?? this.session.getSessionFilePath() ?? null;
          const freshTranscriptRootTarget = this.runtimeContext?.sessionsDirTarget
            ?? deriveCodexSessionsRootFromSessionPath(threadTargetPath)
            ?? this.resolveTranscriptRootTarget(freshSessionFilePathHint);
          sandboxPolicy = this.buildTurnSandboxPolicy(
            externalContextPaths,
            permissionMode.sandbox,
            freshTranscriptRootTarget,
            freshSessionFilePathHint,
          );

          turnResult = await startTurn();
        }
        this.currentTurnId = turnResult.turn.id;
        this.recordTurnMetadata({
          userMessageId: turnResult.turn.id,
          wasSent: true,
        });
        this.flushPendingTurnNotifications();
      }

      // Yield chunks until done or canceled
      const KEEPALIVE_INTERVAL_MS = 15_000;
      keepaliveTimer = window.setInterval(() => {
        if (this.chunkBuffer.length === 0 && !this.canceled) {
          this.chunkBuffer.push({ type: "keepalive" });
          if (this.chunkResolve) {
            this.chunkResolve();
            this.chunkResolve = null;
          }
        }
      }, KEEPALIVE_INTERVAL_MS);

      while (true) {
        if (this.canceled) {
          // Drain remaining chunks before exiting
          while (this.chunkBuffer.length > 0) {
            const chunk = this.chunkBuffer.shift()!;
            yield chunk;
            if (chunk.type === 'done') return;
          }
          yield { type: 'done' };
          return;
        }

        if (this.chunkBuffer.length === 0) {
          await new Promise<void>((resolve) => {
            this.chunkResolve = resolve;
            if (this.chunkBuffer.length > 0 || this.canceled) {
              resolve();
              this.chunkResolve = null;
            }
          });
        }

        while (this.chunkBuffer.length > 0) {
          const chunk = this.chunkBuffer.shift()!;
          if (chunk.type === 'done' && this.goalHold && !this.canceled) {
            const hold = this.goalHold;
            const outcome = await hold.promise;
            if (this.goalHold === hold) this.goalHold = null;
            // Codex started the next round: this "done" only ended a round.
            if (outcome === 'continued' && !this.canceled) continue;
            if (outcome === 'timeout') this.pauseIdleGoal(enqueueChunk);
            // What settled the goal (its final status) arrived after the done.
            for (const trailing of this.chunkBuffer.splice(0)) {
              if (trailing.type !== 'done') yield trailing;
            }
          }
          yield chunk;
          if (chunk.type === 'done') {
            return;
          }
        }
      }
    } catch (err: unknown) {
      if (this.canceled) {
        yield { type: 'done' };
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown Codex error';
      yield { type: 'error', content: message };
      yield { type: 'done' };
      return;
    } finally {
      if (keepaliveTimer !== null) {
        window.clearInterval(keepaliveTimer);
      }
      if (this.activeChunkSink === enqueueChunk) {
        this.activeChunkSink = null;
      }

      // The child relay is kept: background subagents can outlive this turn.
      this.notificationRouter?.endTurn();

      this.cleanupActiveInputBundles();
      this.releaseGoalHold('settled');
      this.pendingGoalActivation = null;
      this.currentTurnId = null;
      this.currentQueryThreadId = null;
      this.pendingTurnNotifications = [];

      // Session file discovery fallback
      if (!this.session.getSessionFilePath()) {
        const threadId = this.session.getThreadId();
        if (threadId) {
          const sessionFilePath = findCodexSessionFile(
            threadId,
            this.resolveTranscriptRootHost(this.session.getSessionFilePath() ?? this.currentThreadPath) ?? undefined,
          );
          if (sessionFilePath) {
            this.session.setThread(threadId, sessionFilePath);
          }
        }
      }
    }
  }

  async steer(turn: PreparedChatTurn): Promise<boolean> {
    if (turn.isCompact || this.canceled) {
      return false;
    }

    const transport = this.transport;
    const threadId = this.currentQueryThreadId;
    const turnId = this.currentTurnId;
    if (!transport || !threadId || !turnId) {
      return false;
    }

    const skillInputs = await this.resolveSkillInputs(turn.request.text);
    const inputBundle = this.buildInput(turn.prompt, turn.request.images, skillInputs);
    this.registerActiveInputBundle(inputBundle);

    try {
      const result = await transport.request<TurnSteerResult>('turn/steer', {
        threadId,
        input: inputBundle.input,
        expectedTurnId: turnId,
      });

      if (result.turnId !== turnId) {
        return false;
      }

      return this.currentQueryThreadId === threadId
        && this.currentTurnId === turnId
        && !this.canceled;
    } catch (error) {
      this.disposeInputBundle(inputBundle);
      throw error;
    }
  }

  cancel(): void {
    this.canceled = true;
    this.dismissAllPendingPrompts();

    const threadId = this.session.getThreadId();
    const turnId = this.currentTurnId;

    if (this.transport && threadId && turnId) {
      this.transport.request('turn/interrupt', { threadId, turnId }).catch(() => {
        // best-effort
      });
    }

    // Stop means stop: an active goal would otherwise make Codex start the
    // next round on its own, with no answer open to show it.
    if (this.pendingGoalActivation) {
      // Still paused on the server; it just never gets activated.
      this.pendingGoalActivation = null;
      if (this.nativeGoal) this.nativeGoal = { ...this.nativeGoal, status: 'paused' };
    } else if (this.transport && threadId && this.nativeGoal?.status === 'active') {
      this.nativeGoal = { ...this.nativeGoal, status: 'paused' };
      this.transport.request('thread/goal/set', { threadId, status: 'paused' }).catch(() => {
        // Applied on the next query instead.
        this.pendingGoalCommand = 'pause';
      });
    }
    this.releaseGoalHold('settled');

    // Unblock the chunk-wait loop
    if (this.chunkResolve) {
      this.chunkResolve();
      this.chunkResolve = null;
    }
  }

  resetSession(): void {
    this.teardownState();
  }

  canCancelSubagent(target: SubagentCancelTarget): boolean {
    return Boolean(this.transport && this.childRelay.interruptTarget(target.id, target.agentId));
  }

  /** Interrupts only the child thread's running turn; the parent turn keeps going. */
  async cancelSubagent(target: SubagentCancelTarget): Promise<boolean> {
    const transport = this.transport;
    const interrupt = this.childRelay.interruptTarget(target.id, target.agentId);
    if (!transport || !interrupt) return false;

    // Marked first: the interrupted turn/completed can arrive before the response.
    this.childRelay.markCancelRequested(interrupt.threadId);
    const params: TurnInterruptParams = { threadId: interrupt.threadId, turnId: interrupt.turnId };
    try {
      await transport.request('turn/interrupt', params);
      return true;
    } catch {
      this.childRelay.clearCancelRequested(interrupt.threadId);
      return false;
    }
  }

  supportsNativeGoal(): boolean {
    return true;
  }

  /**
   * Pauses the thread's goal. A thread this app-server has not loaded yet
   * cannot take the request; it is applied before the next turn instead.
   */
  async pauseNativeGoal(): Promise<NativeGoalState | null> {
    this.releaseGoalHold('settled');
    const threadId = this.currentQueryThreadId ?? this.session.getThreadId();
    if (!threadId) return null;
    const fallback: NativeGoalState | null = this.nativeGoal ? { ...this.nativeGoal, status: 'paused' } : null;
    try {
      await this.ensureReady();
      const result = await this.transport!.request<ThreadGoalSetResult>('thread/goal/set', { threadId, status: 'paused' });
      this.nativeGoal = isCodexThreadGoal(result?.goal) ? toNativeGoalState(result.goal, this.goalRound || undefined) : fallback;
    } catch {
      this.pendingGoalCommand = 'pause';
      this.nativeGoal = fallback;
    }
    return this.nativeGoal;
  }

  async clearNativeGoal(): Promise<void> {
    this.releaseGoalHold('settled');
    this.pendingGoalActivation = null;
    this.nativeGoal = null;
    const threadId = this.currentQueryThreadId ?? this.session.getThreadId();
    if (!threadId) return;
    try {
      await this.ensureReady();
      await this.transport!.request('thread/goal/clear', { threadId });
    } catch {
      this.pendingGoalCommand = 'clear';
    }
  }

  getSessionId(): string | null {
    return this.session.getThreadId();
  }

  consumeSessionInvalidation(): boolean {
    return this.session.consumeInvalidation();
  }

  isReady(): boolean {
    return this.ready;
  }

  private resetTurnMetadata(): void {
    this.turnMetadata = {};
  }

  private recordTurnMetadata(update: Partial<ChatTurnMetadata>): void {
    this.turnMetadata = {
      ...this.turnMetadata,
      ...update,
    };
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  cleanup(): void {
    this.cancel();
    this.teardownState();
    this.readyListeners.clear();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Codex does not support rewind' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
    this.serverRequestRouter.setApprovalCallback(callback);
  }

  setApprovalDismisser(dismisser: (() => void) | null): void {
    this.approvalDismisser = dismisser;
  }

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserCallback = callback;
    this.serverRequestRouter.setAskUserCallback(callback);
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentHookProvider(getState: () => SubagentRuntimeState): void {
    this.subagentHookProvider = getState;
  }

  setAutoTurnCallback(callback: AutoTurnCallback | null): void {
    this.autoTurnCallback = callback;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const threadId = this.session.getThreadId();
    const sessionFilePath = this.session.getSessionFilePath() ?? this.currentThreadPath;
    const transcriptRootPath = this.resolveTranscriptRootHost(sessionFilePath);

    // Preserve forkSource from existing conversation state
    const existingState = params.conversation
      ? getCodexState(params.conversation.providerState)
      : null;

    const providerState: CodexProviderState = {
      ...(threadId ? { threadId } : {}),
      ...(sessionFilePath ? { sessionFilePath } : {}),
      ...(
        transcriptRootPath || existingState?.transcriptRootPath
          ? { transcriptRootPath: transcriptRootPath ?? existingState?.transcriptRootPath }
          : {}
      ),
      ...(existingState?.forkSource ? { forkSource: existingState.forkSource } : {}),
      ...(
        existingState?.forkSourceSessionFilePath
          ? { forkSourceSessionFilePath: existingState.forkSourceSessionFilePath }
          : {}
      ),
      ...(
        existingState?.forkSourceTranscriptRootPath
          ? { forkSourceTranscriptRootPath: existingState.forkSourceTranscriptRootPath }
          : {}
      ),
    };

    const updates: Partial<Conversation> = {
      sessionId: threadId,
      providerState: providerState as Record<string, unknown>,
    };

    if (params.sessionInvalidated && params.conversation) {
      updates.sessionId = null;
      updates.providerState = undefined;
    }

    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    const threadId = this.session.getThreadId();
    if (threadId) return threadId;

    if (!conversation) return null;
    const state = getCodexState(conversation.providerState);
    return state.threadId ?? conversation.sessionId ?? state.forkSource?.sessionId ?? null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private teardownState(): void {
    this.cleanupActiveInputBundles();
    this.childRelay.setParentThread(null);
    this.session.reset();
    this.launchSpec = null;
    this.runtimeContext = null;
    this.loadedThreadId = null;
    this.currentThreadPath = null;
    this.currentTurnId = null;
    this.currentQueryThreadId = null;
    this.pendingTurnNotifications = [];
    this.pendingFork = null;
    this.clientConfigKey = null;
    this.shutdownProcess().catch(() => {});
    this.setReady(false);
  }

  private dismissApprovalUI(): void {
    if (this.approvalDismisser) {
      this.approvalDismisser();
    }
  }

  private dismissAllPendingPrompts(): void {
    this.dismissApprovalUI();
    this.serverRequestRouter.abortPendingAskUser();
  }

  private registerActiveInputBundle(bundle: CodexInputBundle): void {
    this.activeInputBundles.add(bundle);
  }

  private disposeInputBundle(bundle: CodexInputBundle): void {
    if (this.activeInputBundles.delete(bundle)) {
      bundle.cleanup();
      return;
    }

    bundle.cleanup();
  }

  private cleanupActiveInputBundles(): void {
    for (const bundle of this.activeInputBundles) {
      bundle.cleanup();
    }
    this.activeInputBundles.clear();
  }

  private setReady(ready: boolean): void {
    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }

  private getSystemPromptSettings(): SystemPromptSettings {
    const settings = this.plugin.settings;
    return {
      mediaFolder: settings.mediaFolder,
      customPrompt: settings.systemPrompt,
      vaultPath: getVaultPath(this.plugin.app) ?? undefined,
      userName: settings.userName,
      workspaceMode: normalizeWorkspaceMode(settings.workspaceMode),
    };
  }

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
  }

  getAuxiliaryModel(): string | null {
    return this.resolveModel() ?? null;
  }

  private resolveModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const providerSettings = this.getProviderSettings();
    return queryOptions?.model ?? providerSettings.model as string | undefined;
  }

  /**
   * With the large window on, Codex gets OpenAI's documented opt-in (1M window,
   * compaction before it fills) through thread/start|resume `config`.
   */
  private contextWindowConfig(model: string): { config?: Record<string, unknown> } {
    if (!getCodexProviderSettings(this.getProviderSettings()).largeContextWindow) return {};
    const codexHome = this.runtimeContext?.codexHomeHost ?? undefined;
    const large = resolveCodexLargeWindow(model, readCodexCatalogWindow(model, codexHome));
    return large
      ? { config: { model_context_window: large.requested, model_auto_compact_token_limit: large.autoCompactLimit } }
      : {};
  }

  private resolveSandboxConfig(): { approvalPolicy: string; sandbox: string } {
    const providerSettings = this.getProviderSettings();
    return resolveCodexSandboxConfig(
      providerSettings.permissionMode as string,
      getCodexProviderSettings(providerSettings).safeMode,
    );
  }

  private async startAppServer(launchSpec: CodexLaunchSpec, clientConfigKey: string): Promise<void> {
    this.launchSpec = launchSpec;
    this.process = new CodexAppServerProcess(launchSpec);
    this.process.start();

    this.transport = new CodexRpcTransport(this.process);
    this.transport.start();

    const initializeResult = await initializeCodexAppServerTransport(this.transport);
    this.runtimeContext = createCodexRuntimeContext(launchSpec, initializeResult);
    this.clientConfigKey = clientConfigKey;
  }

  private wireTransportHandlers(): void {
    if (!this.transport || !this.notificationRouter) return;

    const router = this.notificationRouter;
    const methods = [
      'item/agentMessage/delta',
      'item/started',
      'item/completed',
      'item/plan/delta',
      'item/reasoning/textDelta',
      'item/reasoning/summaryTextDelta',
      'item/reasoning/summaryPartAdded',
      'thread/tokenUsage/updated',
      'turn/plan/updated',
      'turn/completed',
      'error',
      'thread/started',
      'thread/status/changed',
      'turn/started',
      'serverRequest/resolved',
      'item/commandExecution/outputDelta',
      'item/fileChange/outputDelta',
      'item/fileChange/patchUpdated',
      'rawResponseItem/completed',
      'event_msg',
      'model/rerouted',
    ];

    for (const method of methods) {
      this.transport.onNotification(method, (params) => {
        if (method === 'serverRequest/resolved') {
          this.handleServerRequestResolved(params as ServerRequestResolvedNotification);
          return;
        }
        // Before the foreign-thread rejection, so child traffic never touches
        // the parent's turn state (currentTurnId, pendingTurnNotifications).
        if (this.childRelay.consumeNotification(method, params)) {
          return;
        }
        if (this.routeNotification(method, params)) {
          if (method === 'turn/completed') this.noteGoalRoundCompleted(params);
          router.handleNotification(method, params);
        }
        // After the router, so a spawn's tool_use precedes its relayed children.
        this.childRelay.observeParentNotification(method, params);
      });
    }

    this.transport.onNotification('thread/goal/updated', (params) => this.handleGoalUpdated(params));
    this.transport.onNotification('thread/goal/cleared', (params) => this.handleGoalCleared(params));

    // Server requests (approvals, ask-user)
    const requestMethods = [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/permissions/requestApproval',
      'item/tool/requestUserInput',
    ];

    for (const method of requestMethods) {
      this.transport.onServerRequest(method, (requestId, params) => {
        return this.serverRequestRouter.handleServerRequest(requestId, method, params);
      });
    }
  }

  private async shutdownProcess(): Promise<void> {
    if (this.transport) {
      this.transport.dispose();
      this.transport = null;
    }
    if (this.process) {
      await this.process.shutdown();
      this.process = null;
    }
    this.launchSpec = null;
    this.runtimeContext = null;
    this.notificationRouter = null;
    this.currentTurnId = null;
    this.currentQueryThreadId = null;
    this.pendingTurnNotifications = [];
    this.loadedThreadId = null;
    // Child threads die with the app-server process.
    this.childRelay.reset();
  }

  private resolveExternalContextPaths(
    turn: PreparedChatTurn,
    queryOptions?: ChatRuntimeQueryOptions,
  ): string[] {
    const externalContextPaths = turn.request.externalContextPaths ?? queryOptions?.externalContextPaths ?? [];
    return [...new Set(externalContextPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  }

  private buildTurnSandboxPolicy(
    externalContextPaths: string[],
    sandboxMode: string,
    transcriptRootTargetHint?: string | null,
    sessionFilePathHint?: string | null,
  ): SandboxPolicy | undefined {
    if (sandboxMode === 'danger-full-access') {
      return { type: 'dangerFullAccess' };
    }

    if (sandboxMode === 'read-only') {
      return {
        type: 'readOnly',
        access: { type: 'fullAccess' },
        networkAccess: false,
      };
    }

    if (sandboxMode !== 'workspace-write') {
      return undefined;
    }

    const mappedExternalContextPaths = this.mapRequiredHostPathsToTarget(
      externalContextPaths,
      'external context path',
    );
    const memoriesDirTarget = deriveCodexMemoriesDirFromSessionsRoot(transcriptRootTargetHint)
      ?? this.resolveMemoriesDirTarget(sessionFilePathHint)
      ?? (
        this.launchSpec?.target.method === 'wsl'
          ? null
          : path.join(os.homedir(), '.codex', 'memories')
      );

    const writableRoots = [
      this.launchSpec?.targetCwd ?? getVaultPath(this.plugin.app),
      ...mappedExternalContextPaths,
      memoriesDirTarget,
      this.mapHostPathToTarget(os.tmpdir()),
      this.launchSpec?.target.platformFamily === 'unix' ? '/tmp' : null,
      this.mapHostPathToTarget(process.env.TMPDIR),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    return {
      type: 'workspaceWrite',
      writableRoots: [...new Set(writableRoots)],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }

  private handleServerRequestResolved(params: ServerRequestResolvedNotification): void {
    if (this.serverRequestRouter.hasPendingApprovalRequest(params.requestId, params.threadId)) {
      this.dismissApprovalUI();
      return;
    }

    this.serverRequestRouter.abortPendingAskUser(params.requestId, params.threadId);
  }

  private routeNotification(
    method: string,
    params: unknown,
  ): boolean {
    // turn/started can establish the active turn ID when the query didn't
    // receive one from the RPC response (e.g. thread/compact/start).
    if (method === 'turn/started') {
      this.handleTurnStartedNotification(params);
      return false;
    }

    const scope = this.extractNotificationScope(method, params);
    if (!scope) {
      return true;
    }

    if (!this.currentQueryThreadId || scope.threadId !== this.currentQueryThreadId) {
      return false;
    }

    if (!this.currentTurnId) {
      this.pendingTurnNotifications.push({ method, params });
      return false;
    }

    if (scope.turnId !== this.currentTurnId) {
      return false;
    }

    return true;
  }

  private handleTurnStartedNotification(params: unknown): void {
    if (!params || typeof params !== 'object') return;

    const notification = params as TurnStartedNotification;
    const threadId = notification.threadId;
    const turnId = notification.turn?.id;

    if (!threadId || !turnId) return;
    if (threadId !== this.currentQueryThreadId) return;

    // Only establish the turn ID if the current query doesn't have one yet.
    // Normal turn/start responses already set it; this path covers
    // thread/compact/start which returns {} without a turn.
    if (!this.currentTurnId) {
      this.currentTurnId = turnId;
      this.flushPendingTurnNotifications();
      return;
    }

    if (this.goalHold && !this.goalHold.settled && turnId !== this.currentTurnId) {
      this.beginGoalRound(turnId);
    }
  }

  /**
   * Arms this turn's goal action. The goal is set paused and activated when
   * this turn's first round ends (see pendingGoalActivation), so this prompt,
   * with its carry and attachments, is the turn that starts the work.
   */
  private async armGoalAction(
    threadId: string,
    action: NativeGoalAction,
    enqueue: (chunk: StreamChunk) => void,
  ): Promise<void> {
    let goal: CodexThreadGoal | null;
    if (action.kind === 'set') {
      const params = {
        threadId,
        objective: action.objective,
        status: 'paused',
        ...(action.tokenBudget ? { tokenBudget: action.tokenBudget } : {}),
      };
      const result = await this.transport!.request<ThreadGoalSetResult>('thread/goal/set', params)
        .catch(async () => {
          // An unfinished earlier goal may block setting a new one: end it first.
          await this.transport!.request('thread/goal/clear', { threadId });
          return this.transport!.request<ThreadGoalSetResult>('thread/goal/set', params);
        });
      goal = isCodexThreadGoal(result?.goal) ? result.goal : null;
    } else {
      const result = await this.transport!.request<{ goal?: unknown }>('thread/goal/get', { threadId }).catch(() => null);
      goal = isCodexThreadGoal(result?.goal) ? result.goal : null;
      if (!goal) {
        enqueue({ type: 'notice', level: 'info', content: 'Dieser Codex-Thread hat kein Ziel zum Fortsetzen.' });
        return;
      }
    }
    this.goalRound = 1;
    this.goalSyncedThreadId = threadId;
    this.pendingGoalActivation = threadId;
    this.nativeGoal = goal
      ? { ...toNativeGoalState(goal, 1), status: 'active' }
      : { objective: action.kind === 'set' ? action.objective : '', status: 'active', round: 1 };
    enqueue({ type: 'goal_update', goal: this.nativeGoal });
  }

  /** After a restart the thread may still hold an active goal; show it and follow its rounds. */
  private async syncNativeGoal(threadId: string, enqueue: (chunk: StreamChunk) => void): Promise<void> {
    if (this.goalSyncedThreadId === threadId) return;
    this.goalSyncedThreadId = threadId;
    const result = await this.transport!.request<{ goal?: unknown }>('thread/goal/get', { threadId }).catch(() => null);
    if (!isCodexThreadGoal(result?.goal)) return;
    this.nativeGoal = toNativeGoalState(result.goal);
    enqueue({ type: 'goal_update', goal: this.nativeGoal });
  }

  private async applyPendingGoalCommand(threadId: string): Promise<void> {
    const command = this.pendingGoalCommand;
    if (!command) return;
    this.pendingGoalCommand = null;
    await (command === 'clear'
      ? this.transport!.request('thread/goal/clear', { threadId })
      : this.transport!.request('thread/goal/set', { threadId, status: 'paused' })
    ).catch(() => undefined);
  }

  /** A round ended while the goal is still active: wait for Codex's next round. */
  private noteGoalRoundCompleted(params: unknown): void {
    const status = (params as { turn?: { status?: string } } | null)?.turn?.status;
    if (status !== 'completed' || this.canceled || this.nativeGoal?.status !== 'active') {
      this.pendingGoalActivation = null;
      return;
    }
    this.releaseGoalHold('settled');
    let resolveHold!: (outcome: GoalHoldOutcome) => void;
    const hold: GoalHold = {
      settled: false,
      promise: new Promise<GoalHoldOutcome>((resolve) => { resolveHold = resolve; }),
      resolve: (outcome) => {
        if (hold.settled) return;
        hold.settled = true;
        window.clearTimeout(hold.timer);
        resolveHold(outcome);
      },
      timer: 0,
    };
    hold.timer = window.setTimeout(() => hold.resolve('timeout'), CodexChatRuntime.GOAL_CONTINUATION_GRACE_MS);
    this.goalHold = hold;

    const activateThreadId = this.pendingGoalActivation;
    this.pendingGoalActivation = null;
    if (activateThreadId && this.transport) {
      // From here Codex starts the rounds itself.
      this.transport.request<ThreadGoalSetResult>('thread/goal/set', { threadId: activateThreadId, status: 'active' })
        .then((result) => {
          if (!isCodexThreadGoal(result?.goal)) return;
          this.nativeGoal = toNativeGoalState(result.goal, this.goalRound || undefined);
          if (this.nativeGoal.status !== 'active') hold.resolve('settled');
        })
        .catch(() => hold.resolve('settled'));
    }
  }

  /**
   * No next round came within the grace period. A round Codex started later
   * would run with no answer open, so the goal is paused instead.
   */
  private pauseIdleGoal(enqueue: (chunk: StreamChunk) => void): void {
    const threadId = this.currentQueryThreadId ?? this.session.getThreadId();
    if (!threadId || this.nativeGoal?.status !== 'active') return;
    this.nativeGoal = { ...this.nativeGoal, status: 'paused' };
    enqueue({ type: 'goal_update', goal: this.nativeGoal });
    enqueue({ type: 'notice', level: 'info', content: 'Codex hat keine weitere Runde gestartet; das Ziel ist pausiert. /goal resume setzt es fort.' });
    this.transport?.request('thread/goal/set', { threadId, status: 'paused' }).catch(() => {
      this.pendingGoalCommand = 'pause';
    });
  }

  private beginGoalRound(turnId: string): void {
    this.goalRound += 1;
    this.currentTurnId = turnId;
    this.notificationRouter?.beginTurn({ isPlanTurn: false });
    if (this.nativeGoal) {
      this.nativeGoal = { ...this.nativeGoal, round: this.goalRound };
    }
    this.activeChunkSink?.({ type: 'goal_update', goal: this.nativeGoal, round: this.goalRound });
    this.flushPendingTurnNotifications();
    this.goalHold?.resolve('continued');
  }

  private releaseGoalHold(outcome: GoalHoldOutcome): void {
    this.goalHold?.resolve(outcome);
  }

  private isOwnThread(threadId: unknown): boolean {
    return typeof threadId === 'string'
      && threadId === (this.currentQueryThreadId ?? this.session.getThreadId());
  }

  private handleGoalUpdated(params: unknown): void {
    const notification = params as ThreadGoalUpdatedNotification | null;
    if (!notification || !this.isOwnThread(notification.threadId) || !isCodexThreadGoal(notification.goal)) return;
    const state = toNativeGoalState(notification.goal, this.goalRound || undefined);
    // Paused by armGoalAction for this turn only; for the user it is running.
    if (this.pendingGoalActivation === notification.threadId && state.status === 'paused') {
      state.status = 'active';
    }
    this.nativeGoal = state;
    this.activeChunkSink?.({ type: 'goal_update', goal: this.nativeGoal });
    if (this.nativeGoal.status !== 'active') this.releaseGoalHold('settled');
  }

  private handleGoalCleared(params: unknown): void {
    const notification = params as ThreadGoalClearedNotification | null;
    if (!notification || !this.isOwnThread(notification.threadId)) return;
    this.pendingGoalActivation = null;
    this.nativeGoal = null;
    this.activeChunkSink?.({ type: 'goal_update', goal: null });
    this.releaseGoalHold('settled');
  }

  private validateCompactTurn(turn: PreparedChatTurn): string | null {
    if (!turn.isCompact) {
      return null;
    }

    if (turn.request.text.trim() !== '/compact') {
      return '/compact does not accept arguments';
    }

    return null;
  }

  private flushPendingTurnNotifications(): void {
    if (!this.notificationRouter || !this.currentTurnId) {
      this.pendingTurnNotifications = [];
      return;
    }

    const pending = this.pendingTurnNotifications;
    this.pendingTurnNotifications = [];

    for (const notification of pending) {
      const scope = this.extractNotificationScope(notification.method, notification.params);
      if (!scope) {
        this.notificationRouter.handleNotification(notification.method, notification.params);
        continue;
      }

      if (
        scope.threadId === this.currentQueryThreadId
        && scope.turnId === this.currentTurnId
      ) {
        this.notificationRouter.handleNotification(notification.method, notification.params);
      }
    }
  }

  private extractNotificationScope(
    method: string,
    params: unknown,
  ): { threadId: string; turnId: string } | null {
    if (!params || typeof params !== 'object') {
      return null;
    }

    const notification = params as Record<string, unknown>;
    const threadId = typeof notification.threadId === 'string' ? notification.threadId : null;

    if (method === 'turn/completed') {
      const turn = notification.turn;
      const turnId = turn && typeof turn === 'object' && typeof (turn as Record<string, unknown>).id === 'string'
        ? (turn as Record<string, unknown>).id as string
        : null;

      return threadId && turnId ? { threadId, turnId } : null;
    }

    const turnId = typeof notification.turnId === 'string'
      ? notification.turnId
      : typeof notification.turn_id === 'string'
        ? notification.turn_id
        : null;
    return threadId && turnId ? { threadId, turnId } : null;
  }

  private async resolveSkillInputs(text: string): Promise<SkillInput[]> {
    const skillNames = extractExplicitCodexSkillNames(text);
    if (skillNames.length === 0 || !this.transport) {
      return [];
    }

    try {
      const cwd = this.launchSpec?.targetCwd ?? getVaultPath(this.plugin.app) ?? process.cwd();
      const result = await this.transport.request<SkillsListResult>('skills/list', {
        cwds: [cwd],
      });
      const skills = result.data.find(entry => entry.cwd === cwd)?.skills ?? result.data[0]?.skills ?? [];
      const resolvedInputs: SkillInput[] = [];

      for (const skillName of skillNames) {
        const resolvedSkill = findPreferredCodexSkillByName(skills, skillName);
        if (!resolvedSkill) {
          continue;
        }

        resolvedInputs.push({
          type: 'skill',
          name: resolvedSkill.name,
          path: resolvedSkill.path,
        });
      }

      return resolvedInputs;
    } catch {
      return [];
    }
  }

  private buildInput(text: string, images?: ImageAttachment[], skills?: SkillInput[]): CodexInputBundle {
    const input: UserInput[] = [];
    let tempDir: string | null = null;

    const cleanup = (): void => {
      if (!tempDir) {
        return;
      }

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    };

    try {
      if (images && images.length > 0) {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-codex-images-'));
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          if (!img.mediaType.startsWith('image/')) continue;

          const filename = toAttachmentFilename(img, i);
          const filePath = path.join(tempDir, `${i + 1}-${filename}`);
          fs.writeFileSync(filePath, Buffer.from(img.data, 'base64'));
          const targetFilePath = this.mapHostPathToTarget(filePath);
          if (!targetFilePath) {
            throw new Error(`Codex cannot access image attachment path from the selected target: ${filePath}`);
          }
          input.push({ type: 'localImage', path: targetFilePath });
        }
      }

      if (text) {
        input.push({ type: 'text', text, text_elements: [] });
      }

      if (skills && skills.length > 0) {
        input.push(...skills);
      }

      return { input, cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private toHostSessionPath(targetPath: string | null | undefined): string | null {
    if (!targetPath) {
      return null;
    }

    return this.launchSpec?.pathMapper.toHostPath(targetPath) ?? targetPath;
  }

  private toTargetSessionPath(sessionPath: string | null | undefined): string | null {
    if (!sessionPath) {
      return null;
    }

    if (!this.launchSpec) {
      return sessionPath;
    }

    if (this.launchSpec.target.platformFamily === 'unix' && sessionPath.startsWith('/')) {
      return sessionPath;
    }

    if (
      this.launchSpec.target.platformFamily === 'windows'
      && (/^[A-Za-z]:[\\/]/.test(sessionPath) || sessionPath.startsWith('\\\\'))
    ) {
      return sessionPath;
    }

    return this.launchSpec.pathMapper.toTargetPath(sessionPath) ?? sessionPath;
  }

  private mapHostPathToTarget(hostPath: string | null | undefined): string | null {
    if (!hostPath) {
      return null;
    }

    return this.launchSpec?.pathMapper.toTargetPath(hostPath) ?? hostPath;
  }

  private mapRequiredHostPathsToTarget(hostPaths: string[], label: string): string[] {
    if (!this.launchSpec) {
      return hostPaths;
    }

    return hostPaths.map((hostPath) => {
      const targetPath = this.launchSpec!.pathMapper.toTargetPath(hostPath);
      if (!targetPath) {
        throw new Error(`Codex cannot access ${label} from the selected target: ${hostPath}`);
      }
      return targetPath;
    });
  }

  private resolveTranscriptRootHost(sessionFilePath?: string | null): string | null {
    return this.runtimeContext?.sessionsDirHost
      ?? deriveCodexSessionsRootFromSessionPath(
        sessionFilePath ?? this.session.getSessionFilePath() ?? this.currentThreadPath,
      );
  }

  private resolveTranscriptRootTarget(sessionFilePath?: string | null): string | null {
    if (this.runtimeContext?.sessionsDirTarget) {
      return this.runtimeContext.sessionsDirTarget;
    }

    const targetSessionPath = this.toTargetSessionPath(
      sessionFilePath ?? this.session.getSessionFilePath() ?? this.currentThreadPath,
    );
    return deriveCodexSessionsRootFromSessionPath(targetSessionPath);
  }

  private resolveMemoriesDirTarget(sessionFilePath?: string | null): string | null {
    if (this.runtimeContext?.memoriesDirTarget) {
      return this.runtimeContext.memoriesDirTarget;
    }

    return deriveCodexMemoriesDirFromSessionsRoot(
      this.resolveTranscriptRootTarget(sessionFilePath),
    );
  }
}

function withBoundedHistoryReplay(
  turn: PreparedChatTurn,
  conversationHistory?: ChatMessage[],
): PreparedChatTurn {
  if (!conversationHistory?.length) return turn;
  const history = buildBoundedContextFromHistory(conversationHistory);
  if (!history) return turn;
  return {
    ...turn,
    prompt: `${history}\n\nUser: ${turn.prompt}`,
  };
}

function isCodexContextWindowError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : JSON.stringify(error ?? '');
  return /ran out of room|context window|clear earlier history|maximum context|context length/i.test(message);
}

// ---------------------------------------------------------------------------
// Image attachment helpers
// ---------------------------------------------------------------------------

interface ImageAttachment {
  data: string;
  mediaType: string;
  filename?: string;
}

interface CodexInputBundle {
  input: UserInput[];
  cleanup: () => void;
}

function toAttachmentFilename(attachment: ImageAttachment, index: number): string {
  const base = (attachment.filename ?? '').trim().replace(/[^A-Za-z0-9._-]/g, '_') || `image-${index + 1}`;
  if (base.includes('.')) return base;
  const subtype = attachment.mediaType.split('/')[1] ?? 'img';
  const extension = subtype === 'jpeg' ? 'jpg' : subtype;
  return `${base}.${extension}`;
}

export { toAttachmentFilename as _toAttachmentFilename };

// ---------------------------------------------------------------------------
// Interrupt kind classification (preserved for history parsing)
// ---------------------------------------------------------------------------

export type CodexInterruptKind = 'user_request' | 'tool_use' | 'compaction_canceled';

export function mapCodexAbortReasonToInterruptKind(reason: string): CodexInterruptKind | undefined {
  const normalized = reason.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'interrupted' || normalized === 'cancelled' || normalized === 'canceled') {
    return 'user_request';
  }
  if (normalized.includes('tool')) {
    return 'tool_use';
  }
  if (normalized.includes('compact')) {
    return 'compaction_canceled';
  }

  return undefined;
}

type GoalHoldOutcome = 'continued' | 'settled' | 'timeout';

interface GoalHold {
  settled: boolean;
  promise: Promise<GoalHoldOutcome>;
  resolve: (outcome: GoalHoldOutcome) => void;
  timer: number;
}
