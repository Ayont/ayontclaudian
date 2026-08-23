import type { ChatRuntime } from '../runtime/ChatRuntime';
import type { ChatRuntimeEnsureReadyOptions, ChatRuntimeQueryOptions, PreparedChatTurn } from '../runtime/types';
import type { StreamChunk } from '../types/chat';
import {
  buildGoalVerificationPrompt,
  type GoalVerdict,
  normalizeGoalLoopIterations,
  parseGoalVerdict,
} from './goalLoop';
import { type GoalLoopRunnerDeps,runGoalLoopRunner as runGoalLoop } from './goalLoopRunner';
import { extractGoalFromPrompt } from './goalPrompt';

export interface GoalLoopWrapperOptions {
  isPaused: () => boolean;
  maxIterations?: number;
}

function runTurnQuery(
  base: ChatRuntime,
  preparedTurn: PreparedChatTurn,
  prompt: string,
  echoUserMessage: boolean,
  queryOptions?: ChatRuntimeQueryOptions,
): AsyncGenerator<StreamChunk> {
  async function* inner(): AsyncGenerator<StreamChunk> {
    const turn = { ...preparedTurn, prompt };
    for await (const chunk of base.query(turn, undefined, queryOptions)) {
      if (!echoUserMessage && chunk.type === 'user_message_start') continue;
      yield chunk;
    }
  }
  return inner();
}

async function collectText(
  base: ChatRuntime,
  preparedTurn: PreparedChatTurn,
  prompt: string,
): Promise<string | null> {
  let text = '';
  try {
    for await (const chunk of base.query({ ...preparedTurn, prompt })) {
      if (chunk.type === 'text') text += chunk.content;
      if (chunk.type === 'error') return null;
    }
  } catch {
    return null;
  }
  return text;
}

/** Returns a runtime with the same surface as `base`, but every query that
 *  carries a framed standing goal runs the verify-and-continue loop instead.
 *  All other members delegate with a stable `this`. */
export function withGoalLoop(base: ChatRuntime, options: GoalLoopWrapperOptions): ChatRuntime {
  const maxIterations = normalizeGoalLoopIterations(options.maxIterations);

  async function* loop(
    preparedTurn: PreparedChatTurn,
    goal: string,
    queryOptions?: ChatRuntimeQueryOptions
  ): AsyncGenerator<StreamChunk> {
    const deps: GoalLoopRunnerDeps = {
      maxIterations,
      isPaused: () => options.isPaused(),
      isCancelled: () => false,
      runTurn: (prompt, runOptions) => runTurnQuery(base, preparedTurn, prompt, runOptions.echoUserMessage, queryOptions),
      verify: async (verifyGoal: string, work: string): Promise<GoalVerdict | null> => {
        const raw = await collectText(base, preparedTurn, buildGoalVerificationPrompt(verifyGoal, work));
        return raw ? parseGoalVerdict(raw) : null;
      },
    };
    yield* runGoalLoop({ goal, initialPrompt: preparedTurn.prompt, deps });
  }

  return {
    providerId: base.providerId,
    getCapabilities: () => base.getCapabilities(),
    prepareTurn: (request) => base.prepareTurn(request),
    onReadyStateChange: (listener) => base.onReadyStateChange(listener),
    setResumeCheckpoint: (checkpointId) => base.setResumeCheckpoint(checkpointId),
    syncConversationState: (conversation, externalContextPaths) => base.syncConversationState(conversation, externalContextPaths),
    reloadMcpServers: () => base.reloadMcpServers(),
    ensureReady: async (ensureOptions?: ChatRuntimeEnsureReadyOptions) => base.ensureReady(ensureOptions),
    query(preparedTurn, conversationHistory, queryOptions) {
      const goal = extractGoalFromPrompt(preparedTurn.prompt);
      if (!goal) {
        return base.query(preparedTurn, conversationHistory, queryOptions);
      }
      return loop(preparedTurn, goal, queryOptions);
    },
    cancel: () => base.cancel(),
    resetSession: () => base.resetSession(),
    getSessionId: () => base.getSessionId(),
    consumeSessionInvalidation: () => base.consumeSessionInvalidation(),
    isReady: () => base.isReady(),
    getSupportedCommands: () => base.getSupportedCommands(),
    cleanup: () => base.cleanup(),
    rewind: (userMessageId, assistantMessageId, mode) => base.rewind(userMessageId, assistantMessageId, mode),
    setApprovalCallback: (callback) => base.setApprovalCallback(callback),
    setApprovalDismisser: (dismisser) => base.setApprovalDismisser(dismisser),
    setAskUserQuestionCallback: (callback) => base.setAskUserQuestionCallback(callback),
    setExitPlanModeCallback: (callback) => base.setExitPlanModeCallback(callback),
    setPermissionModeSyncCallback: (callback) => base.setPermissionModeSyncCallback(callback),
    setSubagentHookProvider: (getState) => base.setSubagentHookProvider(getState),
    setAutoTurnCallback: (callback) => base.setAutoTurnCallback(callback),
    consumeTurnMetadata: () => base.consumeTurnMetadata(),
    buildSessionUpdates: (params) => base.buildSessionUpdates(params),
    resolveSessionIdForFork: (conversation) => base.resolveSessionIdForFork(conversation)
  };
}