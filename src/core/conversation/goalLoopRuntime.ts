import { buildAuxiliaryUsageReport } from '../auxiliary/AuxiliaryUsageAccounting';
import type { AuxQueryRunner } from '../auxiliary/AuxQueryRunner';
import type { ChatRuntime } from '../runtime/ChatRuntime';
import type {
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  PreparedChatTurn,
} from '../runtime/types';
import type { ChatMessage, StreamChunk, UsageInfo } from '../types/chat';
import {
  buildGoalVerificationPrompt,
  type GoalVerdict,
  normalizeGoalLoopIterations,
  parseGoalVerdict,
} from './goalLoop';
import { type GoalLoopRunnerDeps, runGoalLoopRunner as runGoalLoop } from './goalLoopRunner';
import { extractGoalFromPrompt } from './goalPrompt';

export interface GoalLoopWrapperOptions {
  /** Fresh, session-isolated transport for each hidden verifier call. */
  createVerifierRunner?: () => AuxQueryRunner;
  isPaused: () => boolean;
  maxIterations?: number;
  /** Required for stateless transports whose next query cannot see this loop's prior output. */
  replayAccumulatedWork?: boolean;
  /** Hard deadline for the hidden verifier. Primarily configurable for tests. */
  verificationTimeoutMs?: number;
  /** Bounded teardown grace for an aborted verifier. Primarily configurable for tests. */
  verificationAbortGraceMs?: number;
}

interface ActiveVerifierRun {
  abortController: AbortController;
  acceptingUsage: boolean;
  runner: AuxQueryRunner;
}

const GOAL_VERIFIER_SYSTEM_PROMPT =
  'Du bist ein strenger Prüfer und antwortest ausschließlich mit dem angeforderten JSON.';

function overrideTurnPrompt(
  preparedTurn: PreparedChatTurn,
  prompt: string,
): PreparedChatTurn {
  return {
    ...preparedTurn,
    request: {
      ...preparedTurn.request,
      text: prompt,
    },
    persistedContent: prompt,
    prompt,
  };
}

/**
 * One visible goal run can execute several provider turns (work plus skeptical
 * verification). A provider's `final` report is final for that inner query, not
 * for the aggregate assistant message, so expose it as an additive delta at the
 * orchestration boundary. Snapshots remain snapshots for the context meter.
 */
function normalizeNestedUsage(chunk: StreamChunk): StreamChunk {
  if (chunk.type !== 'usage' || chunk.usage.reportType !== 'final') {
    return chunk;
  }
  return {
    ...chunk,
    usage: {
      ...chunk.usage,
      reportType: 'delta',
    },
  };
}

function consumeBaseTurnMetadata(base: ChatRuntime): ChatTurnMetadata {
  return typeof base.consumeTurnMetadata === 'function'
    ? base.consumeTurnMetadata()
    : {};
}

/**
 * One visible goal message may span several work queries. Keep the first native
 * user id (the visible turn's real checkpoint), the latest visible assistant id,
 * and additive flags. Hidden verifier ids are consumed separately and discarded.
 */
function mergeVisibleTurnMetadata(
  current: ChatTurnMetadata,
  next: ChatTurnMetadata,
): ChatTurnMetadata {
  const merged: ChatTurnMetadata = { ...current, ...next };
  if (current.userMessageId) merged.userMessageId = current.userMessageId;
  if (next.assistantMessageId) merged.assistantMessageId = next.assistantMessageId;
  if (current.wasSent === true || next.wasSent === true) merged.wasSent = true;
  if (current.planCompleted === true || next.planCompleted === true) merged.planCompleted = true;
  return merged;
}

function runTurnQuery(
  base: ChatRuntime,
  preparedTurn: PreparedChatTurn,
  prompt: string,
  echoUserMessage: boolean,
  conversationHistory?: ChatMessage[],
  queryOptions?: ChatRuntimeQueryOptions,
  onMetadata?: (metadata: ChatTurnMetadata) => void,
): AsyncGenerator<StreamChunk> {
  async function* inner(): AsyncGenerator<StreamChunk> {
    const turn = overrideTurnPrompt(preparedTurn, prompt);
    try {
      for await (const chunk of base.query(turn, conversationHistory, queryOptions)) {
        if (!echoUserMessage && chunk.type === 'user_message_start') continue;
        yield normalizeNestedUsage(chunk);
      }
    } finally {
      onMetadata?.(consumeBaseTurnMetadata(base));
    }
  }
  return inner();
}

/** Returns a runtime with the same surface as `base`, but every query that
 *  carries a framed standing goal runs the verify-and-continue loop instead.
 *  All other members delegate with a stable `this`. */
export function withGoalLoop(base: ChatRuntime, options: GoalLoopWrapperOptions): ChatRuntime {
  const maxIterations = normalizeGoalLoopIterations(options.maxIterations);
  let cancelled = false;
  let pendingGoalTurnMetadata: ChatTurnMetadata | null = null;
  let activeVerifier: ActiveVerifierRun | null = null;

  const stopActiveVerifier = (): void => {
    const current = activeVerifier;
    if (!current) return;
    current.acceptingUsage = false;
    current.abortController.abort();
    try {
      current.runner.reset();
    } catch {
      // Cancellation must remain best-effort even for third-party runners.
    }
  };

  const recordVisibleTurnMetadata = (metadata: ChatTurnMetadata): void => {
    pendingGoalTurnMetadata = mergeVisibleTurnMetadata(
      pendingGoalTurnMetadata ?? {},
      metadata,
    );
  };

  const verifyInIsolatedRunner = async (params: {
    goal: string;
    model?: string;
    pendingUsage: StreamChunk[];
    signal: AbortSignal;
    work: string;
  }): Promise<GoalVerdict | null> => {
    if (!options.createVerifierRunner) return null;

    const runner = options.createVerifierRunner();
    const abortController = new AbortController();
    const state: ActiveVerifierRun = {
      abortController,
      acceptingUsage: true,
      runner,
    };
    activeVerifier = state;
    const usageReports: UsageInfo[] = [];
    const prompt = buildGoalVerificationPrompt(params.goal, params.work);
    const abort = (): void => {
      state.acceptingUsage = false;
      abortController.abort();
      try {
        runner.reset();
      } catch {
        // The abort signal is still delivered even if cleanup throws.
      }
    };
    if (params.signal.aborted) abort();
    params.signal.addEventListener('abort', abort, { once: true });

    let completed = false;
    let raw = '';
    try {
      raw = await runner.query({
        abortController,
        model: params.model,
        onUsage: (usage) => {
          if (state.acceptingUsage) usageReports.push(usage);
        },
        systemPrompt: GOAL_VERIFIER_SYSTEM_PROMPT,
      }, prompt);
      completed = true;
      return parseGoalVerdict(raw);
    } catch {
      return null;
    } finally {
      params.signal.removeEventListener('abort', abort);
      state.acceptingUsage = false;
      try {
        runner.reset();
      } catch {
        // The verifier is already isolated; cleanup cannot break the visible turn.
      }
      if (activeVerifier === state) activeVerifier = null;

      if (completed || usageReports.length > 0) {
        const usage = buildAuxiliaryUsageReport({
          inputTexts: [GOAL_VERIFIER_SYSTEM_PROMPT, prompt],
          model: params.model,
          outputText: raw,
          providerId: base.providerId,
          ...(usageReports.length > 0 ? { usageReports } : {}),
        });
        if (usage) {
          params.pendingUsage.push({ type: 'usage', usage, contextDisplay: 'preserve' });
        }
      }
    }
  };

  async function* loop(
    preparedTurn: PreparedChatTurn,
    goal: string,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions
  ): AsyncGenerator<StreamChunk> {
    const pendingVerificationUsage: StreamChunk[] = [];
    const deps: GoalLoopRunnerDeps = {
      maxIterations,
      replayAccumulatedWork: options.replayAccumulatedWork,
      isPaused: () => options.isPaused(),
      isCancelled: () => cancelled,
      runTurn: (prompt, runOptions) => runTurnQuery(
        base,
        preparedTurn,
        prompt,
        runOptions.echoUserMessage,
        conversationHistory,
        queryOptions,
        recordVisibleTurnMetadata,
      ),
      verify: options.createVerifierRunner
        ? (verifyGoal, work, signal) => verifyInIsolatedRunner({
            goal: verifyGoal,
            model: queryOptions?.model,
            pendingUsage: pendingVerificationUsage,
            signal,
            work,
          })
        : null,
      drainVerificationChunks: () => pendingVerificationUsage.splice(0),
      verificationAbortGraceMs: options.verificationAbortGraceMs,
      verificationTimeoutMs: options.verificationTimeoutMs,
    };
    yield* runGoalLoop({ goal, initialPrompt: preparedTurn.prompt, deps });
  }

  const wrapped: ChatRuntime = {
    providerId: base.providerId,
    getCapabilities: () => base.getCapabilities(),
    prepareTurn: (request) => base.prepareTurn(request),
    onReadyStateChange: (listener) => base.onReadyStateChange(listener),
    setResumeCheckpoint: (checkpointId) => base.setResumeCheckpoint(checkpointId),
    syncConversationState: (conversation, externalContextPaths) => base.syncConversationState(conversation, externalContextPaths),
    reloadMcpServers: () => base.reloadMcpServers(),
    ensureReady: async (ensureOptions?: ChatRuntimeEnsureReadyOptions) => base.ensureReady(ensureOptions),
    query(preparedTurn, conversationHistory, queryOptions) {
      stopActiveVerifier();
      activeVerifier = null;
      cancelled = false;
      const goal = extractGoalFromPrompt(preparedTurn.prompt);
      if (!goal) {
        pendingGoalTurnMetadata = null;
        return base.query(preparedTurn, conversationHistory, queryOptions);
      }
      pendingGoalTurnMetadata = {};
      return loop(preparedTurn, goal, conversationHistory, queryOptions);
    },
    cancel: () => {
      cancelled = true;
      stopActiveVerifier();
      base.cancel();
    },
    resetSession: () => {
      stopActiveVerifier();
      activeVerifier = null;
      base.resetSession();
    },
    getSessionId: () => base.getSessionId(),
    consumeSessionInvalidation: () => base.consumeSessionInvalidation(),
    isReady: () => base.isReady(),
    getSupportedCommands: () => base.getSupportedCommands(),
    cleanup: () => {
      stopActiveVerifier();
      activeVerifier = null;
      base.cleanup();
    },
    rewind: (userMessageId, assistantMessageId, mode) => base.rewind(userMessageId, assistantMessageId, mode),
    setApprovalCallback: (callback) => base.setApprovalCallback(callback),
    setApprovalDismisser: (dismisser) => base.setApprovalDismisser(dismisser),
    setAskUserQuestionCallback: (callback) => base.setAskUserQuestionCallback(callback),
    setExitPlanModeCallback: (callback) => base.setExitPlanModeCallback(callback),
    setPermissionModeSyncCallback: (callback) => base.setPermissionModeSyncCallback(callback),
    setSubagentHookProvider: (getState) => base.setSubagentHookProvider(getState),
    setAutoTurnCallback: (callback) => base.setAutoTurnCallback(callback),
    consumeTurnMetadata: () => {
      if (pendingGoalTurnMetadata !== null) {
        const metadata = pendingGoalTurnMetadata;
        pendingGoalTurnMetadata = null;
        return metadata;
      }
      return consumeBaseTurnMetadata(base);
    },
    buildSessionUpdates: (params) => base.buildSessionUpdates(params),
    resolveSessionIdForFork: (conversation) => base.resolveSessionIdForFork(conversation),
  };

  // Keep optional capabilities genuinely optional while preserving provider
  // implementations that depend on their runtime instance as `this`.
  if (base.steer) {
    wrapped.steer = (turn) => base.steer!.call(base, turn);
  }
  if (base.softSteer) {
    wrapped.softSteer = (turn) => base.softSteer!.call(base, turn);
  }
  if (base.getAuxiliaryModel) {
    wrapped.getAuxiliaryModel = () => base.getAuxiliaryModel!.call(base);
  }
  if (base.loadSubagentToolCalls) {
    wrapped.loadSubagentToolCalls = (agentId) => base.loadSubagentToolCalls!.call(base, agentId);
  }
  if (base.loadSubagentFinalResult) {
    wrapped.loadSubagentFinalResult = (agentId) => base.loadSubagentFinalResult!.call(base, agentId);
  }

  return wrapped;
}
