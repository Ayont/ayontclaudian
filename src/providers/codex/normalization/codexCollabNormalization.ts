/**
 * Codex multi-agent (collab) projection shared by the live notification
 * router, the child-thread relay and the subagent lifecycle adapter.
 *
 * Collab items are translated into snake_case tool calls whose input and
 * result JSON use the same keys as the raw `spawn_agent` / `wait` function
 * calls, so one adapter can read live, raw and reloaded tool calls alike.
 */
import type {
  CollabAgentState,
  CollabAgentStatus,
  CollabAgentToolCallItem,
  SubAgentActivityItem,
} from '../runtime/codexAppServerTypes';

export const TOOL_SEND_MESSAGE = 'send_message' as const;
export const TOOL_FOLLOWUP_TASK = 'followup_task' as const;
export const TOOL_INTERRUPT_AGENT = 'interrupt_agent' as const;
export const TOOL_LIST_AGENTS = 'list_agents' as const;
/**
 * Claudian-made, never sent by Codex: a multi-agent v2 `subAgentActivity`
 * completion replayed as a hidden status call, because v2 parents never call
 * `wait` and the lifecycle adapter only settles cards from status calls.
 */
export const TOOL_CODEX_SUBAGENT_ACTIVITY = 'subagent_activity' as const;

/** Keys written into collab tool inputs/results; read back by the lifecycle adapter. */
export const COLLAB_KEYS = {
  agentId: 'agent_id',
  agentsStates: 'agents_states',
  receiverThreadIds: 'receiver_thread_ids',
  spawnToolId: 'spawn_tool_id',
  targets: 'targets',
} as const;

const COLLAB_TOOL_NAMES: Record<string, string> = {
  spawnAgent: 'spawn_agent',
  sendInput: 'send_input',
  resumeAgent: 'resume_agent',
  wait: 'wait',
  closeAgent: 'close_agent',
  sendMessage: TOOL_SEND_MESSAGE,
  followupTask: TOOL_FOLLOWUP_TASK,
  interruptAgent: TOOL_INTERRUPT_AGENT,
  listAgents: TOOL_LIST_AGENTS,
};

const COLLAB_AGENT_STATUSES: ReadonlySet<string> = new Set<CollabAgentStatus>([
  'pendingInit',
  'running',
  'interrupted',
  'completed',
  'errored',
  'shutdown',
  'notFound',
]);

// Fernet tokens (what Codex Desktop stores for encrypted collab messages)
// start with version byte 0x80 plus a zero-leading timestamp.
const FERNET_TOKEN_PATTERN = /^gAAAAA[A-Za-z0-9_-]+={0,2}$/;
const LONG_BASE64_PATTERN = /^[A-Za-z0-9+/_-]{120,}={0,2}$/;

export function normalizeCodexCollabToolName(tool: string): string {
  return COLLAB_TOOL_NAMES[tool] ?? tool;
}

/** True for payloads a human cannot read (encrypted or bare base64 blobs). */
export function isOpaqueCodexPayload(text: string): boolean {
  const trimmed = text.trim();
  return FERNET_TOKEN_PATTERN.test(trimmed) || LONG_BASE64_PATTERN.test(trimmed);
}

/** A trimmed string worth showing to the user, or '' for anything else. */
export function readReadableCodexText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && !isOpaqueCodexPayload(trimmed) ? trimmed : '';
}

/** `writing_style` for both `writing_style` and the agent path `/root/writing_style`. */
export function toCodexTaskLabel(value: unknown): string {
  const text = readReadableCodexText(value);
  const segments = text.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

/** Validates wire agent states; unknown statuses carry no meaning for us. */
export function readCodexAgentStates(value: unknown): Record<string, CollabAgentState> {
  const record = asRecord(value);
  if (!record) return {};

  const states: Record<string, CollabAgentState> = {};
  for (const [threadId, rawState] of Object.entries(record)) {
    const state = asRecord(rawState);
    const status = state?.status;
    if (typeof status !== 'string' || !COLLAB_AGENT_STATUSES.has(status)) continue;
    const message = typeof state?.message === 'string' && state.message ? state.message : undefined;
    states[threadId] = { status: status as CollabAgentStatus, ...(message ? { message } : {}) };
  }
  return states;
}

/** Agent states from a collab tool result produced by {@link buildCodexCollabToolResult}. */
export function extractCodexAgentStates(raw: string | undefined): Record<string, CollabAgentState> {
  return readCodexAgentStates(parseJsonObject(raw)?.[COLLAB_KEYS.agentsStates]);
}

export function readCodexThreadIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
}

export function buildCodexCollabToolInput(item: CollabAgentToolCallItem): Record<string, unknown> {
  const legacyArguments = asRecord(item.arguments) ?? {};
  const prompt = readReadableCodexText(item.prompt);
  const model = readNonEmptyString(item.model);
  const reasoningEffort = readNonEmptyString(item.reasoningEffort);
  const receivers = readCodexThreadIds(item.receiverThreadIds);
  const states = readCodexAgentStates(item.agentsStates);

  return {
    ...legacyArguments,
    ...(prompt ? { prompt } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(receivers.length > 0 ? { [COLLAB_KEYS.receiverThreadIds]: receivers } : {}),
    ...(hasEntries(states) ? { [COLLAB_KEYS.agentsStates]: states } : {}),
  };
}

export function buildCodexCollabToolResult(item: CollabAgentToolCallItem): string {
  if (item.result && typeof item.result === 'object') {
    return JSON.stringify(item.result);
  }

  const receivers = readCodexThreadIds(item.receiverThreadIds);
  const states = readCodexAgentStates(item.agentsStates);
  if (receivers.length === 0 && !hasEntries(states)) {
    return item.status === 'completed' ? 'Completed' : item.status ?? 'Done';
  }

  const spawnedThreadId = item.tool === 'spawnAgent' ? receivers[0] : undefined;
  return JSON.stringify({
    ...(spawnedThreadId ? { [COLLAB_KEYS.agentId]: spawnedThreadId } : {}),
    ...(receivers.length > 0 ? { [COLLAB_KEYS.receiverThreadIds]: receivers } : {}),
    ...(hasEntries(states) ? { [COLLAB_KEYS.agentsStates]: states } : {}),
  });
}

export function isCodexCollabToolCallError(item: CollabAgentToolCallItem): boolean {
  // 'error' predates the v2 status enum.
  return item.status === 'failed' || (item.status as string) === 'error';
}

export interface CodexSubAgentActivityLink {
  spawnToolId?: string;
  finalText?: string;
}

export function buildCodexSubAgentActivityToolCall(
  item: SubAgentActivityItem,
  link: CodexSubAgentActivityLink,
): { input: Record<string, unknown>; content: string } {
  const status: CollabAgentStatus = item.kind === 'interrupted' ? 'interrupted' : 'completed';
  // An interrupted child's last text is a fragment, not its answer.
  const message = status === 'completed' ? link.finalText?.trim() : undefined;
  const state: CollabAgentState = { status, ...(message ? { message } : {}) };

  return {
    input: {
      [COLLAB_KEYS.targets]: [item.agentThreadId],
      agent_path: item.agentPath,
      kind: item.kind,
      ...(link.spawnToolId ? { [COLLAB_KEYS.spawnToolId]: link.spawnToolId } : {}),
    },
    content: JSON.stringify({ [COLLAB_KEYS.agentsStates]: { [item.agentThreadId]: state } }),
  };
}

function hasEntries(record: Record<string, unknown>): boolean {
  return Object.keys(record).length > 0;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}
