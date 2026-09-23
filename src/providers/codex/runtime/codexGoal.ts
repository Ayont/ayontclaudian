import type { NativeGoalState, NativeGoalStatus } from '../../../core/types';

/** `ThreadGoalStatus` of the app-server protocol (codex-cli 0.156). */
export type CodexThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete';

export interface CodexThreadGoal {
  threadId: string;
  objective: string;
  status: CodexThreadGoalStatus;
  tokenBudget?: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface ThreadGoalSetResult { goal: CodexThreadGoal }
export interface ThreadGoalUpdatedNotification { threadId: string; turnId?: string | null; goal: CodexThreadGoal }
export interface ThreadGoalClearedNotification { threadId: string }

const STATUS: Record<CodexThreadGoalStatus, NativeGoalStatus> = {
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
  usageLimited: 'usage_limited',
  budgetLimited: 'budget_limited',
  complete: 'complete',
};

export function toNativeGoalState(goal: CodexThreadGoal, round?: number): NativeGoalState {
  return {
    objective: goal.objective,
    status: STATUS[goal.status] ?? 'active',
    ...(round ? { round } : {}),
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget ?? null,
    timeUsedSeconds: goal.timeUsedSeconds,
  };
}

export function isCodexThreadGoal(value: unknown): value is CodexThreadGoal {
  if (!value || typeof value !== 'object') return false;
  const goal = value as Record<string, unknown>;
  return typeof goal.objective === 'string' && typeof goal.status === 'string';
}
