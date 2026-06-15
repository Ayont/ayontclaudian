import type { ChatMessage, StreamChunk, SubagentInfo, ToolCallInfo, ToolDiffData } from '../../../core/types';
import {
  countLineChanges,
  diffFromToolInput,
} from '../../../utils/diff';
import {
  type AntigravitySubagentRef,
  type AntigravityToolCall,
  type AntigravityTranscriptEvent,
  buildToolInput,
  canonicalToolName,
  cleanToolContent,
  extractEventThinking,
  hasPlannerToolCalls,
  humanizeToolType,
  isAssistantTextEvent,
  isContentTruncated,
  isIgnorableEvent,
  isSubagentEvent,
  isToolErrorStatus,
  isToolEvent,
  isToolTerminalStatus,
  parsePlannerToolCalls,
  parseTranscript,
  stripAgyTrailingRecap,
  subagentRefFromEvent,
  unwrapUserRequest,
} from './transcript';

const TRUNCATION_NOTICE = '\n\n_(output truncated by agy)_';

/** Diff recovered for an Edit/Write step, plus the source unified text if any. */
interface AntigravityDiffResult {
  diffData: ToolDiffData;
  /** Unified-diff text when the diff came from the result content (git diff). */
  unifiedDiff?: string;
}

/**
 * Builds `ToolDiffData` for an Edit/Write tool step when recoverable, reusing
 * the shared diff helpers (`diffFromToolInput`). Returns `undefined` when there
 * is no old/new text or content to diff — the caller then shows a plain
 * file-path + content card instead. Never throws on unexpected input.
 */
function buildAntigravityDiff(
  canonicalName: string,
  input: Record<string, unknown>,
  content: string | undefined,
): AntigravityDiffResult | undefined {
  if (canonicalName !== 'Edit' && canonicalName !== 'Write') {
    return undefined;
  }
  const filePath =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.path === 'string' && input.path) ||
    'file';

  // Preferred: shared old/new + content diffing keyed on the canonical name.
  const fromInput = diffFromToolInput({ id: '', name: canonicalName, input, status: 'completed' }, filePath);
  if (fromInput) {
    return { diffData: fromInput };
  }

  // Fallback: a unified diff baked into the result content (e.g. agy ran
  // `git diff` / `git show`). Recover hunks defensively.
  const unified = extractUnifiedDiff(content);
  if (unified) {
    const diffLines = parseUnifiedDiffLinesLocal(unified);
    if (diffLines.length > 0) {
      return {
        diffData: { filePath, diffLines, stats: countLineChanges(diffLines) },
        unifiedDiff: unified,
      };
    }
  }
  return undefined;
}

/** Pulls the first unified-diff body (`@@ … @@` hunks) out of arbitrary content. */
function extractUnifiedDiff(content: string | undefined): string | undefined {
  if (!content || !content.includes('@@')) {
    return undefined;
  }
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.startsWith('@@') || line.startsWith('--- '));
  if (start === -1) {
    return undefined;
  }
  return lines.slice(start).join('\n');
}

/** Minimal unified-diff line parser (mirrors utils/diff's private helper). */
function parseUnifiedDiffLinesLocal(diffText: string): ToolDiffData['diffLines'] {
  const diffLines: ToolDiffData['diffLines'] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  for (const line of diffText.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff --git')) continue;
    if (line.startsWith('@@')) {
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLineNum = Number(match[1]);
        newLineNum = Number(match[2]);
      }
      continue;
    }
    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === '+') {
      diffLines.push({ type: 'insert', text, newLineNum: newLineNum++ });
    } else if (prefix === '-') {
      diffLines.push({ type: 'delete', text, oldLineNum: oldLineNum++ });
    } else if (prefix === ' ') {
      diffLines.push({ type: 'equal', text, oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
    }
  }
  return diffLines;
}

/**
 * Maps Antigravity transcript events onto the plugin's stream + message
 * contracts. The raw line parsing lives in `transcript.ts`; this module turns
 * parsed events into `StreamChunk`s (live tailing) and `ChatMessage`s
 * (history hydration).
 *
 * Mapping (per the verified v1.0.3 schema):
 *   - MODEL / PLANNER_RESPONSE        -> assistant text (streamed delta)
 *   - MODEL / RUN_COMMAND|VIEW_FILE|… -> tool_use (first sight) + tool_result
 *                                        (on DONE/ERROR), one step = one tool
 *   - USER_INPUT                      -> user message (hydration only)
 *   - CONVERSATION_HISTORY / SYSTEM   -> ignored
 *
 * Each agy tool step grows under one `step_index` (RUNNING → DONE), so live
 * tailing de-dupes per step: the `tool_use` is emitted once, the `tool_result`
 * once the step reaches a terminal status.
 */

/** Per-conversation tailing state, threaded across transcript polls. */
export interface AntigravityTailState {
  /** Full assistant text already emitted per planner step (delta tracking). */
  seenTextByStep: Map<number, string>;
  /** Tool steps whose `tool_use` chunk has been emitted. */
  emittedToolUse: Set<number>;
  /** Tool steps whose terminal `tool_result` chunk has been emitted. */
  emittedToolResult: Set<number>;
  /** Planner tool calls awaiting correlation with the next MODEL tool step(s). */
  pendingToolCalls: AntigravityToolCall[];
  /** Resolved planner call per tool step (so use + result share one input). */
  resolvedCallByStep: Map<number, AntigravityToolCall | null>;
  /** Planner steps whose `thinking` chunk has already been emitted. */
  emittedThinking: Set<number>;
  /** Subagent ref per tool step (when the step belongs to a subagent). */
  subagentByStep: Map<number, AntigravitySubagentRef>;
}

/** Fresh tailing state for a new query loop. */
export function createAntigravityTailState(): AntigravityTailState {
  return {
    seenTextByStep: new Map<number, string>(),
    emittedToolUse: new Set<number>(),
    emittedToolResult: new Set<number>(),
    pendingToolCalls: [],
    resolvedCallByStep: new Map<number, AntigravityToolCall | null>(),
    emittedThinking: new Set<number>(),
    subagentByStep: new Map<number, AntigravitySubagentRef>(),
  };
}

/**
 * Resolves (once, then caches) which planner `tool_call` describes a given tool
 * step. agy emits the planner's `tool_calls` array in the PLANNER_RESPONSE step
 * just before the MODEL tool steps that execute them, in order — so we shift the
 * next pending call off the queue the first time we see a step.
 */
function resolveCallForStep(
  state: AntigravityTailState,
  stepIndex: number,
): AntigravityToolCall | undefined {
  if (state.resolvedCallByStep.has(stepIndex)) {
    return state.resolvedCallByStep.get(stepIndex) ?? undefined;
  }
  const call = state.pendingToolCalls.shift() ?? null;
  state.resolvedCallByStep.set(stepIndex, call);
  return call ?? undefined;
}

/** Canonical (or humanized) display name for a tool step given its planner call. */
function toolNameForStep(
  event: AntigravityTranscriptEvent,
  call: AntigravityToolCall | undefined,
): string {
  if (call) {
    const canonical = canonicalToolName(call.name);
    if (canonical) {
      return canonical;
    }
  }
  const canonicalFromType = canonicalToolName(event.type);
  return canonicalFromType ?? humanizeToolType(event.type);
}

function toolIdFromEvent(event: AntigravityTranscriptEvent): string {
  const raw = event.raw;
  const candidate = raw.tool_call_id ?? raw.call_id ?? raw.id;
  if (typeof candidate === 'string' && candidate.trim()) {
    return candidate.trim();
  }
  return `agy-tool-${event.stepIndex}`;
}

/** Result content for a tool step, with a marker appended when agy truncated it. */
function toolResultContent(event: AntigravityTranscriptEvent): string {
  const cleaned = cleanToolContent(event.content);
  return isContentTruncated(event) ? `${cleaned}${TRUNCATION_NOTICE}` : cleaned;
}

/**
 * Maps a single transcript event onto stream chunks for live tailing.
 *
 * Text events emit only the un-emitted delta versus `state.seenTextByStep` so a
 * growing `PLANNER_RESPONSE` step does not duplicate text across polls. A planner
 * step's `tool_calls` array is stashed (its entries describe the *input* of the
 * MODEL tool steps that follow) and a `thinking` chunk is emitted once per step.
 * Tool steps emit a `tool_use` on first sight and a `tool_result` once terminal,
 * each at most once per `step_index`; subagent steps emit the `subagent_*`
 * variants instead. Edit/Write steps carry `diffData` on the result.
 */
export function mapTranscriptEventToChunks(
  event: AntigravityTranscriptEvent,
  state: AntigravityTailState,
): StreamChunk[] {
  // A planner narration step both streams text and may queue tool calls + carry
  // reasoning. Handle thinking + tool-call stashing before the ignorable gate so
  // we never lose the correlation, then fall through to text delta emission.
  const chunks: StreamChunk[] = [];

  if (hasPlannerToolCalls(event)) {
    state.pendingToolCalls.push(...parsePlannerToolCalls(event));
  }

  const thinking = extractEventThinking(event);
  if (thinking && !state.emittedThinking.has(event.stepIndex)) {
    state.emittedThinking.add(event.stepIndex);
    chunks.push({ type: 'thinking', content: thinking });
  }

  if (isIgnorableEvent(event)) {
    return chunks;
  }

  if (isAssistantTextEvent(event)) {
    const full = stripAgyTrailingRecap(event.content ?? '');
    const seen = state.seenTextByStep.get(event.stepIndex) ?? '';
    if (full.length > seen.length) {
      const delta = full.slice(seen.length);
      state.seenTextByStep.set(event.stepIndex, full);
      if (delta) {
        chunks.push({ type: 'text', content: delta });
      }
    }
    return chunks;
  }

  if (isToolEvent(event)) {
    const call = resolveCallForStep(state, event.stepIndex);
    const name = toolNameForStep(event, call);
    const input = buildToolInput(event, call);
    const id = toolIdFromEvent(event);

    const subagent = isSubagentEvent(event, call)
      ? (state.subagentByStep.get(event.stepIndex) ?? rememberSubagent(state, event, call))
      : undefined;

    if (!state.emittedToolUse.has(event.stepIndex)) {
      state.emittedToolUse.add(event.stepIndex);
      chunks.push(
        subagent
          ? { type: 'subagent_tool_use', subagentId: subagent.id, id, name, input }
          : { type: 'tool_use', id, name, input },
      );
    }

    if (isToolTerminalStatus(event.status) && !state.emittedToolResult.has(event.stepIndex)) {
      state.emittedToolResult.add(event.stepIndex);
      const content = toolResultContent(event);
      const isError = isToolErrorStatus(event.status);
      // Only the unified-diff fallback needs to ride along on the result — the
      // input-based diff is recomputed downstream from the tool_use input.
      const diff = buildAntigravityDiff(name, input, event.content);
      const toolUseResult =
        diff?.unifiedDiff !== undefined
          ? { filePath: diff.diffData.filePath, diff: diff.unifiedDiff }
          : undefined;
      chunks.push(
        subagent
          ? { type: 'subagent_tool_result', subagentId: subagent.id, id, content, isError }
          : {
              type: 'tool_result',
              id,
              content,
              isError,
              ...(toolUseResult ? { toolUseResult } : {}),
            },
      );
    }

    return chunks;
  }

  return chunks;
}

function rememberSubagent(
  state: AntigravityTailState,
  event: AntigravityTranscriptEvent,
  call: AntigravityToolCall | undefined,
): AntigravitySubagentRef {
  const ref = subagentRefFromEvent(event, call);
  state.subagentByStep.set(event.stepIndex, ref);
  return ref;
}

function eventTimestamp(event: AntigravityTranscriptEvent, fallback: number): number {
  if (event.createdAt) {
    const parsed = Date.parse(event.createdAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function buildSubagentInfo(
  ref: AntigravitySubagentRef,
  status: ToolCallInfo['status'],
  result: string | undefined,
): SubagentInfo {
  const subagentStatus: SubagentInfo['status'] = status === 'error' ? 'error' : status === 'running' ? 'running' : 'completed';
  return {
    id: ref.id,
    description: ref.description,
    isExpanded: false,
    status: subagentStatus,
    toolCalls: [],
    ...(result ? { result } : {}),
  };
}

function toolCallFromEvent(
  event: AntigravityTranscriptEvent,
  previous: ToolCallInfo | undefined,
  call: AntigravityToolCall | undefined,
): ToolCallInfo {
  const terminal = isToolTerminalStatus(event.status);
  const status: ToolCallInfo['status'] = isToolErrorStatus(event.status)
    ? 'error'
    : terminal
      ? 'completed'
      : 'running';
  const result = terminal ? toolResultContent(event) : previous?.result;
  const name = toolNameForStep(event, call);
  const input = buildToolInput(event, call);

  const toolCall: ToolCallInfo = {
    id: toolIdFromEvent(event),
    name,
    input,
    status,
    ...(result ? { result } : {}),
  };

  if (isSubagentEvent(event, call)) {
    toolCall.subagent = buildSubagentInfo(subagentRefFromEvent(event, call), status, result);
  } else {
    const diff = buildAntigravityDiff(name, input, event.content);
    if (diff) {
      toolCall.diffData = diff.diffData;
    }
  }

  return toolCall;
}

/**
 * Reconstructs a conversation's chat messages from a full transcript buffer.
 *
 * USER_INPUT events become user messages (unwrapped from the `<USER_REQUEST>`
 * marker); a turn's MODEL planner steps are joined into one assistant message
 * and its tool steps are attached as `toolCalls` (a later DONE step supersedes
 * its earlier RUNNING line via `step_index`).
 */
export function transcriptToChatMessages(buffer: string): ChatMessage[] {
  const events = parseTranscript(buffer);
  const messages: ChatMessage[] = [];
  let counter = 0;

  let assistant: ChatMessage | null = null;
  let textByStep = new Map<number, string>();
  let toolByStep = new Map<number, ToolCallInfo>();

  // Planner `tool_calls` describe the input of the MODEL tool steps that follow
  // them, in order. Queue them as we walk the transcript and resolve one per
  // step (cached, so the RUNNING and DONE lines of a step share an input).
  const pendingToolCalls: AntigravityToolCall[] = [];
  const resolvedCallByStep = new Map<number, AntigravityToolCall | null>();
  const resolveCall = (stepIndex: number): AntigravityToolCall | undefined => {
    if (resolvedCallByStep.has(stepIndex)) {
      return resolvedCallByStep.get(stepIndex) ?? undefined;
    }
    const call = pendingToolCalls.shift() ?? null;
    resolvedCallByStep.set(stepIndex, call);
    return call ?? undefined;
  };

  const flushAssistant = (): void => {
    if (!assistant) {
      return;
    }
    const text = [...textByStep.entries()]
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1].trim())
      .filter(Boolean)
      .join('\n\n');
    const tools = [...toolByStep.entries()]
      .sort((left, right) => left[0] - right[0])
      .map((entry) => entry[1]);

    assistant.content = text;
    if (tools.length > 0) {
      assistant.toolCalls = tools;
    }
    if (assistant.content.trim() || tools.length > 0) {
      messages.push(assistant);
    }
    assistant = null;
    textByStep = new Map<number, string>();
    toolByStep = new Map<number, ToolCallInfo>();
  };

  const ensureAssistant = (event: AntigravityTranscriptEvent): void => {
    if (!assistant) {
      assistant = {
        id: `agy-assistant-${event.stepIndex}-${counter++}`,
        role: 'assistant',
        content: '',
        timestamp: eventTimestamp(event, Date.now()),
      };
    }
  };

  for (const event of events) {
    if (event.type === 'CONVERSATION_HISTORY') {
      continue;
    }

    // Capture planner tool calls before any other handling so the correlation
    // survives even when the planner step also carries narration text.
    if (hasPlannerToolCalls(event)) {
      pendingToolCalls.push(...parsePlannerToolCalls(event));
    }

    if (event.type === 'USER_INPUT') {
      flushAssistant();
      // A new user turn invalidates any unconsumed tool-call correlation.
      pendingToolCalls.length = 0;
      resolvedCallByStep.clear();
      const text = unwrapUserRequest(event.content ?? '');
      if (text) {
        messages.push({
          id: `agy-user-${event.stepIndex}-${counter++}`,
          role: 'user',
          content: text,
          timestamp: eventTimestamp(event, Date.now()),
        });
      }
      continue;
    }

    if (isAssistantTextEvent(event)) {
      ensureAssistant(event);
      textByStep.set(event.stepIndex, stripAgyTrailingRecap(event.content ?? ''));
      continue;
    }

    if (isToolEvent(event)) {
      ensureAssistant(event);
      const call = resolveCall(event.stepIndex);
      toolByStep.set(event.stepIndex, toolCallFromEvent(event, toolByStep.get(event.stepIndex), call));
    }
  }

  flushAssistant();
  return messages;
}
