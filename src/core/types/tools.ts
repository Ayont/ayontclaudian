import type { DiffLine, DiffStats } from './diff';

/** Diff data for Write/Edit tool operations (pre-computed from SDK structuredPatch). */
export interface ToolDiffData {
  filePath: string;
  diffLines: DiffLine[];
  stats: DiffStats;
}

/** Parsed option for AskUserQuestion tool. */
export interface AskUserQuestionOption {
  label: string;
  description: string;
  value?: string;
}

/** Parsed question for AskUserQuestion tool. */
export interface AskUserQuestionItem {
  question: string;
  id?: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

/** User-provided answers keyed by question text or stable question id. */
export type AskUserAnswers = Record<string, string | string[]>;

/** Tool call tracking with status and result. */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'running' | 'completed' | 'error' | 'blocked';
  result?: string;
  isExpanded?: boolean;
  diffData?: ToolDiffData;
  resolvedAnswers?: AskUserAnswers;
  subagent?: SubagentInfo;
}

export type ExitPlanModeDecision =
  | { type: 'approve' }
  | { type: 'approve-new-session'; planContent: string }
  | { type: 'feedback'; text: string };

export type ExitPlanModeCallback = (
  input: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<ExitPlanModeDecision | null>;

/** Subagent execution mode: sync (nested tools) or async (background). */
export type SubagentMode = 'sync' | 'async';

/** Async subagent lifecycle states. */
export type AsyncSubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'orphaned';

/** Subagent (Agent tool, legacy Task) tracking for sync and async modes. */
export interface SubagentInfo {
  id: string;
  description: string;
  prompt?: string;
  mode?: SubagentMode;
  isExpanded: boolean;
  result?: string;
  status: 'running' | 'completed' | 'error';
  toolCalls: ToolCallInfo[];
  asyncStatus?: AsyncSubagentStatus;
  agentId?: string;
  outputToolId?: string;
  startedAt?: number;
  completedAt?: number;
  /** Distinguishes Claude Code workflow tasks from ordinary Agent/Task subagents. */
  kind?: 'agent' | 'workflow';
  workflowName?: string;
  taskType?: string;
  progressSummary?: string;
  lastToolName?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** Provider that ran the turn; the inspector shows provenance from it. */
  providerId?: string;
  /** Provider's agent role or type (Claude `subagent_type`, Codex role). */
  agentType?: string;
  model?: string;
  /** Provider-native handle for stopping this one subagent (Claude task_id). */
  taskId?: string;
  /** Present-tense activity line reported by the provider. */
  activity?: string;
  /** Ordered child transcript (text and tool calls), bounded; see appendSubagentTimeline. */
  timeline?: SubagentTimelineEntry[];
  /** Set once the user asked to stop it, and again once the provider confirmed. */
  cancelState?: SubagentCancelState;
}

export type SubagentCancelState = 'requested' | 'cancelled';

/** `seq` is a stable per-subagent counter, so trimming the front never renames an entry. */
export type SubagentTimelineEntry =
  | { type: 'text'; text: string; at: number; seq?: number }
  | { type: 'tool'; toolId: string; at: number; seq?: number };

/** Live facts a provider reports about a running subagent; every field is optional. */
export interface SubagentLiveUpdate {
  taskId?: string;
  agentType?: string;
  model?: string;
  description?: string;
  prompt?: string;
  activity?: string;
  lastToolName?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** The provider confirmed that this subagent was stopped. */
  cancelled?: boolean;
  /** Known at launch on Claude: lets the card appear before any child event. */
  background?: boolean;
}

/** What a runtime needs to stop exactly one subagent. */
export interface SubagentCancelTarget {
  /** Claudian's subagent id: the spawning tool call id. */
  id: string;
  taskId?: string;
  agentId?: string;
  mode?: SubagentMode;
}
