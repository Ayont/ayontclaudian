import type { ProviderSubagentLifecycleAdapter } from '../../../core/providers/types';
import {
  TOOL_CLOSE_AGENT,
  TOOL_RESUME_AGENT,
  TOOL_SEND_INPUT,
  TOOL_SPAWN_AGENT,
  TOOL_WAIT,
  TOOL_WAIT_AGENT,
} from '../../../core/tools/toolNames';
import type { SubagentCancelState, SubagentInfo, ToolCallInfo } from '../../../core/types';
import type { CollabAgentState } from '../runtime/codexAppServerTypes';
import {
  COLLAB_KEYS,
  extractCodexAgentStates,
  readCodexThreadIds,
  readReadableCodexText,
  toCodexTaskLabel,
  TOOL_CODEX_SUBAGENT_ACTIVITY,
  TOOL_FOLLOWUP_TASK,
  TOOL_INTERRUPT_AGENT,
  TOOL_LIST_AGENTS,
  TOOL_SEND_MESSAGE,
} from './codexCollabNormalization';

interface CodexSpawnResult {
  agentId?: string;
  nickname?: string;
  /** Multi-agent v2 spawns answer with the agent path instead of an id. */
  taskName?: string;
}

interface CodexWaitStatus {
  completed?: string;
  error?: string;
  failed?: string;
}

interface CodexWaitResult {
  statuses: Record<string, CodexWaitStatus>;
  timedOut: boolean;
}

interface CodexSubagentCompletion {
  status: SubagentInfo['status'];
  result?: string;
  cancelState?: SubagentCancelState;
}

/**
 * Strong observations replace what is known; weak ones (a timeout, a clean
 * shutdown) only settle a subagent that is still running, so a later
 * close_agent or an unrelated timed-out wait cannot undo a completion.
 */
interface CodexSubagentObservation {
  completion: CodexSubagentCompletion;
  strength: 'strong' | 'weak';
}

const SUBAGENT_NOT_FOUND_TEXT = 'Subagent nicht gefunden';
const SUBAGENT_STOPPED_TEXT = 'Subagent gestoppt';

/** Lifecycle calls rendered through the spawn card instead of their own tool row. */
const HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  TOOL_WAIT,
  TOOL_WAIT_AGENT,
  TOOL_CLOSE_AGENT,
  TOOL_SEND_MESSAGE,
  TOOL_FOLLOWUP_TASK,
  TOOL_LIST_AGENTS,
  TOOL_INTERRUPT_AGENT,
  TOOL_CODEX_SUBAGENT_ACTIVITY,
]);

/**
 * Calls whose result reports child state and may settle a card. interrupt_agent
 * and list_agents report the same agent states a wait does.
 */
const STATUS_TOOLS: ReadonlySet<string> = new Set([
  TOOL_WAIT,
  TOOL_WAIT_AGENT,
  TOOL_INTERRUPT_AGENT,
  TOOL_LIST_AGENTS,
  TOOL_CODEX_SUBAGENT_ACTIVITY,
]);

const LEGACY_WAIT_TOOLS: ReadonlySet<string> = new Set([TOOL_WAIT, TOOL_WAIT_AGENT]);

/** Only these calls may carry agent states; anything else is never inspected. */
const COLLAB_TOOLS: ReadonlySet<string> = new Set([
  ...HIDDEN_TOOLS,
  TOOL_SPAWN_AGENT,
  TOOL_SEND_INPUT,
  TOOL_RESUME_AGENT,
]);

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function extractCodexSpawnResult(raw: string | undefined): CodexSpawnResult {
  const parsed = parseJsonObject(raw);
  if (!parsed) return {};

  const taskName = readString(parsed.task_name);
  return {
    agentId: typeof parsed.agent_id === 'string' ? parsed.agent_id : undefined,
    nickname: typeof parsed.nickname === 'string' ? parsed.nickname : undefined,
    ...(taskName ? { taskName } : {}),
  };
}

export function extractCodexWaitResult(raw: string | undefined): CodexWaitResult {
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return { statuses: {}, timedOut: false };
  }

  const rawStatuses = parsed.status;
  const statuses: Record<string, CodexWaitStatus> = {};

  if (rawStatuses && typeof rawStatuses === 'object' && !Array.isArray(rawStatuses)) {
    for (const [agentId, value] of Object.entries(rawStatuses as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const status = value as Record<string, unknown>;
      statuses[agentId] = {
        completed: typeof status.completed === 'string' ? status.completed : undefined,
        error: typeof status.error === 'string' ? status.error : undefined,
        failed: typeof status.failed === 'string' ? status.failed : undefined,
      };
    }
  }

  return {
    statuses,
    timedOut: parsed.timed_out === true,
  };
}

function getCodexSubagentPrompt(input: Record<string, unknown>): string {
  return readReadableCodexText(input.prompt) || readReadableCodexText(input.message);
}

function getCodexSubagentModel(input: Record<string, unknown>): string {
  return typeof input.model === 'string' ? input.model : '';
}

function getCodexSubagentAgentType(
  input: Record<string, unknown>,
  taskLabel: string,
  nickname: string | undefined,
): string | undefined {
  return readString(input.agent_type) ?? readString(input.agent_role) ?? (taskLabel || nickname);
}

function getCodexSubagentDescription(
  label: string | undefined,
  model: string,
): string {
  if (label && model) return `${label} (${model})`;
  if (label) return label;
  if (model) return `Codex subagent (${model})`;
  return 'Codex subagent';
}

function strong(completion: CodexSubagentCompletion): CodexSubagentObservation {
  return { completion, strength: 'strong' };
}

function weak(completion: CodexSubagentCompletion): CodexSubagentObservation {
  return { completion, strength: 'weak' };
}

function observeAgentState(state: CollabAgentState): CodexSubagentObservation | null {
  const message = readString(state.message);
  switch (state.status) {
    case 'completed':
      return strong({ status: 'completed', result: message });
    case 'errored':
      return strong({ status: 'error', result: message });
    case 'notFound':
      return strong({ status: 'error', result: message ?? SUBAGENT_NOT_FOUND_TEXT });
    case 'interrupted':
      return strong({ status: 'error', result: message ?? SUBAGENT_STOPPED_TEXT, cancelState: 'cancelled' });
    case 'shutdown':
      // A clean shutdown carries no message; one that does is reporting a failure.
      return message ? strong({ status: 'error', result: message }) : weak({ status: 'completed' });
    default:
      return null;
  }
}

function observeLegacyWait(
  waitResult: CodexWaitResult,
  agentId: string | undefined,
): CodexSubagentObservation | null {
  const statusEntries = Object.entries(waitResult.statuses);
  if (statusEntries.length === 0 && !waitResult.timedOut) {
    return null;
  }

  let agentStatus: CodexWaitStatus | undefined;
  if (agentId) {
    agentStatus = waitResult.statuses[agentId];
  } else if (statusEntries.length === 1) {
    agentStatus = statusEntries[0][1];
  }

  if (agentStatus?.completed) {
    return strong({ status: 'completed', result: agentStatus.completed });
  }

  const failure = agentStatus?.error ?? agentStatus?.failed;
  if (failure) {
    return strong({ status: 'error', result: failure });
  }

  return waitResult.timedOut ? weak({ status: 'error', result: 'Timed out' }) : null;
}

function applyObservation(
  current: CodexSubagentCompletion,
  observation: CodexSubagentObservation,
): CodexSubagentCompletion {
  if (observation.strength === 'weak' && current.status !== 'running') {
    return current;
  }

  const next = observation.completion;
  const result = next.result ?? (next.status === current.status ? current.result : undefined);
  return {
    status: next.status,
    ...(result !== undefined ? { result } : {}),
    ...(next.cancelState ? { cancelState: next.cancelState } : {}),
  };
}

function pickAgentState(
  states: Record<string, CollabAgentState>,
  agentId: string | undefined,
  allowSingleEntry: boolean,
): CollabAgentState | undefined {
  if (agentId) return states[agentId];
  const entries = Object.values(states);
  return allowSingleEntry && entries.length === 1 ? entries[0] : undefined;
}

function isLinkedToSpawn(toolCall: ToolCallInfo, spawnToolId: string): boolean {
  return toolCall.id !== spawnToolId && toolCall.input?.[COLLAB_KEYS.spawnToolId] === spawnToolId;
}

function readTargetIds(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  return [
    ...readCodexThreadIds(input[COLLAB_KEYS.targets]),
    ...readCodexThreadIds(input.ids),
    ...readCodexThreadIds(input[COLLAB_KEYS.receiverThreadIds]),
  ];
}

/** Walks the turn's lifecycle calls in order; the latest decisive observation wins. */
function resolveCodexSubagentCompletion(
  spawnToolCall: ToolCallInfo,
  spawnResult: CodexSpawnResult,
  siblingToolCalls: ToolCallInfo[],
): { completion: CodexSubagentCompletion; agentId?: string } {
  const toolCalls = siblingToolCalls.some(toolCall => toolCall.id === spawnToolCall.id)
    ? siblingToolCalls
    : [spawnToolCall, ...siblingToolCalls];
  let agentId = spawnResult.agentId;
  let completion: CodexSubagentCompletion = { status: 'running' };

  for (const toolCall of toolCalls) {
    if (!COLLAB_TOOLS.has(toolCall.name)) continue;

    if (!agentId && isLinkedToSpawn(toolCall, spawnToolCall.id)) {
      agentId = readTargetIds(toolCall.input)[0];
    }

    const state = pickAgentState(
      extractCodexAgentStates(toolCall.result),
      agentId,
      STATUS_TOOLS.has(toolCall.name),
    );
    const stateObservation = state ? observeAgentState(state) : null;
    if (stateObservation) {
      completion = applyObservation(completion, stateObservation);
    }

    if (LEGACY_WAIT_TOOLS.has(toolCall.name)) {
      const legacyObservation = observeLegacyWait(extractCodexWaitResult(toolCall.result), agentId);
      if (legacyObservation) {
        completion = applyObservation(completion, legacyObservation);
      }
    }
  }

  return { completion, ...(agentId ? { agentId } : {}) };
}

export function buildCodexSubagentInfo(
  spawnToolCall: ToolCallInfo,
  siblingToolCalls: ToolCallInfo[] = [],
): SubagentInfo {
  const input = spawnToolCall.input ?? {};
  const prompt = getCodexSubagentPrompt(input);
  const model = getCodexSubagentModel(input);
  const spawnResult = extractCodexSpawnResult(spawnToolCall.result);
  const taskLabel = toCodexTaskLabel(input.task_name) || toCodexTaskLabel(spawnResult.taskName);
  const agentType = getCodexSubagentAgentType(input, taskLabel, spawnResult.nickname);
  const base = {
    id: spawnToolCall.id,
    description: getCodexSubagentDescription(spawnResult.nickname ?? (taskLabel || undefined), model),
    prompt,
    mode: 'sync' as const,
    isExpanded: false,
    toolCalls: [],
    providerId: 'codex',
    ...(agentType ? { agentType } : {}),
    ...(model ? { model } : {}),
  };

  if (spawnToolCall.status === 'error') {
    return {
      ...base,
      status: 'error',
      result: spawnToolCall.result,
    };
  }

  const { completion, agentId } = resolveCodexSubagentCompletion(spawnToolCall, spawnResult, siblingToolCalls);

  return {
    ...base,
    status: completion.status,
    result: completion.result,
    ...(completion.cancelState ? { cancelState: completion.cancelState } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

export function isCodexSubagentSpawnToolCall(toolCall: ToolCallInfo): boolean {
  return toolCall.name === TOOL_SPAWN_AGENT;
}

function resolveCodexSpawnToolIds(
  statusToolCall: ToolCallInfo,
  agentIdToSpawnId: ReadonlyMap<string, string>,
): string[] {
  const spawnIds = new Set<string>();
  const linkedSpawnId = statusToolCall.input?.[COLLAB_KEYS.spawnToolId];
  if (typeof linkedSpawnId === 'string' && linkedSpawnId) {
    spawnIds.add(linkedSpawnId);
  }

  const agentIds = [
    ...Object.keys(extractCodexWaitResult(statusToolCall.result).statuses),
    ...Object.keys(extractCodexAgentStates(statusToolCall.result)),
    ...readTargetIds(statusToolCall.input),
  ];
  for (const agentId of agentIds) {
    const spawnId = agentIdToSpawnId.get(agentId);
    if (spawnId) {
      spawnIds.add(spawnId);
    }
  }

  return [...spawnIds];
}

export const codexSubagentLifecycleAdapter: ProviderSubagentLifecycleAdapter = {
  isHiddenTool(name: string): boolean {
    return HIDDEN_TOOLS.has(name);
  },
  isSpawnTool(name: string): boolean {
    return name === TOOL_SPAWN_AGENT;
  },
  isWaitTool(name: string): boolean {
    return STATUS_TOOLS.has(name);
  },
  isCloseTool(name: string): boolean {
    return name === TOOL_CLOSE_AGENT;
  },
  resolveSpawnToolIds(waitToolCall, agentIdToSpawnId): string[] {
    return resolveCodexSpawnToolIds(waitToolCall, agentIdToSpawnId);
  },
  buildSubagentInfo(spawnToolCall, siblingToolCalls = []): SubagentInfo {
    return buildCodexSubagentInfo(spawnToolCall, siblingToolCalls);
  },
  extractSpawnResult(raw: string | undefined) {
    return extractCodexSpawnResult(raw);
  },
  extractWaitResult(raw: string | undefined) {
    return extractCodexWaitResult(raw);
  },
};
