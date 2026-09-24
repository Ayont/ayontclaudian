/**
 * Parsing + classification for Vibe CLI's `--output-format stream-json` output.
 *
 * CRITICAL (live-probed vibe v1.47): unlike Claude Code / Codex stream-json
 * (type-tagged event/delta streams), Vibe emits ONE COMPLETE OpenAI
 * ChatCompletion message object per NDJSON line, keyed by `role` — there is no
 * top-level `type` discriminator, no incremental text deltas, and no terminal
 * `usage`/`result` line. The run simply ends when the process exits.
 *
 * Line shapes (discriminator = `role`):
 *   - role: "assistant"  — `content` is a string OR an array of content parts
 *       ({type:"think",think} for reasoning, {type:"text",text} for visible
 *       text), with OPTIONAL `tool_calls` (OpenAI function-call entries whose
 *       `function.arguments` is a JSON-encoded STRING).
 *   - role: "tool"       — tool result; `content` is an array of {type:"text",
 *       text} parts (first part is often a `<system>...</system>` status
 *       wrapper), correlated to a prior assistant call via `tool_call_id`.
 *
 * vibe 2.x (verified against the installed 2.25.8 source, app_server/models.py)
 * writes camelCase PublicHistoryEntry objects tagged by `type` instead:
 * `message` (role + text blocks), `reasoning`, `effect` (a finished tool call
 * with its result), `checkpoint` (`kind: "compaction"` moves to a new session),
 * `notice` and `callback`. Both shapes parse into the same event.
 *
 * This module turns raw lines into a stable, internal event shape. The mapping
 * onto chat chunks/messages lives in `streamMapping.ts`.
 */

export type VibeEventRole = 'assistant' | 'tool' | (string & {});

/** A reasoning ("think") content part — only present when thinking mode is on. */
export interface VibeThinkPart {
  type: 'think';
  text: string;
}

/** A visible assistant text content part. */
export interface VibeTextPart {
  type: 'text';
  text: string;
}

export type VibeContentPart = VibeThinkPart | VibeTextPart;

/** An OpenAI-style function tool call carried on an assistant message. */
export interface VibeToolCall {
  id: string;
  name: string;
  /** Parsed `function.arguments` (best effort; `{}` when not valid JSON object). */
  input: Record<string, unknown>;
}

/** A normalized Vibe stream-json line. */
export interface VibeStreamEvent {
  role: VibeEventRole;
  /** Visible text + reasoning parts, in order (string content becomes one text part). */
  parts: VibeContentPart[];
  /** Tool calls on an assistant message (empty when none). */
  toolCalls: VibeToolCall[];
  /** Correlation id on a `role: "tool"` result line. */
  toolCallId?: string;
  /** vibe 2.x entry kind (`message`, `reasoning`, `effect`, `checkpoint`, …); absent on 1.x lines. */
  entryType?: string;
  /** vibe 2.x session the entry belongs to. */
  sessionId?: string;
  /** vibe 2.x creation time (epoch ms); a resumed run first replays older entries. */
  createdAt?: number;
  /** A finished vibe 2.x effect carries its tool result on the same line. */
  toolResult?: { content: string; isError: boolean };
  /** A finished vibe 2.x compaction; vibe continues in a new session. */
  compaction?: { newSessionId?: string };
  /** Original parsed object, for fields not yet modelled (e.g. a session id). */
  raw: Record<string, unknown>;
}

function toStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  const text = toStr(value);
  if (!text || !text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON arguments are surfaced verbatim under a stable key.
  }
  return { arguments: text };
}

function parseContentParts(content: unknown): VibeContentPart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  const parts: VibeContentPart[] = [];
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const type = toStr(record.type);
    if (type === 'think') {
      const think = toStr(record.think) ?? toStr(record.text);
      if (think) {
        parts.push({ type: 'think', text: think });
      }
      continue;
    }
    if (type === 'text') {
      const text = toStr(record.text);
      if (text) {
        parts.push({ type: 'text', text });
      }
    }
  }
  return parts;
}

function parseToolCalls(value: unknown): VibeToolCall[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const calls: VibeToolCall[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const fn = record.function;
    if (!fn || typeof fn !== 'object') {
      continue;
    }
    const fnRecord = fn as Record<string, unknown>;
    const name = toStr(fnRecord.name);
    if (!name) {
      continue;
    }
    const id = toStr(record.id) ?? `vibe-tool-${calls.length}`;
    calls.push({ id, name, input: parseToolArguments(fnRecord.arguments) });
  }
  return calls;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// vibe 2.25.8 `ToolEffectKind` → the chat's canonical tool names and input keys.
function canonicalEffectCall(detail: Record<string, unknown>): { name: string; input: Record<string, unknown> } {
  const kind = toStr(detail.kind) ?? '';
  const toolName = toStr(detail.toolName) ?? kind;
  const input = toRecord(detail.input) ?? {};
  const text = (key: string): string | undefined => toStr(input[key]);
  switch (kind) {
    case 'shell':
      return { name: 'Bash', input: { command: text('command') ?? '' } };
    case 'file_read':
      return { name: 'Read', input: { file_path: text('filePath') ?? '' } };
    case 'file_write':
      return { name: 'Write', input: { file_path: text('filePath') ?? '', content: text('content') ?? '' } };
    case 'file_edit':
      return {
        name: 'Edit',
        input: {
          file_path: text('filePath') ?? '',
          ...(text('oldString') !== undefined ? { old_string: text('oldString') } : {}),
          ...(text('newString') !== undefined ? { new_string: text('newString') } : {}),
        },
      };
    case 'file_search':
      return { name: 'Grep', input: { pattern: text('pattern') ?? '', path: text('path') ?? '.' } };
    case 'web_search':
      return { name: 'WebSearch', input: { query: text('query') ?? '' } };
    case 'web_fetch':
      return { name: 'WebFetch', input: { url: text('url') ?? '' } };
    default:
      return { name: humanizeVibeTool(toolName), input };
  }
}

/** Reads one vibe 2.x PublicHistoryEntry (app_server/models.py), or null when it is not one. */
function parseHistoryEntry(record: Record<string, unknown>, type: string): VibeStreamEvent | null {
  const common = {
    entryType: type,
    sessionId: toStr(record.sessionId),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : undefined,
    toolCalls: [] as VibeToolCall[],
    raw: record,
  };
  switch (type) {
    case 'message':
      return { ...common, role: toStr(record.role) ?? 'assistant', parts: parseContentParts(record.content) };
    case 'reasoning': {
      const text = toStr(record.text);
      return { ...common, role: 'assistant', parts: text ? [{ type: 'think', text }] : [] };
    }
    case 'effect': {
      const detail = toRecord(record.detail) ?? {};
      const state = toRecord(record.state) ?? {};
      const id = toStr(record.id) ?? 'vibe-effect';
      const call = canonicalEffectCall(detail);
      const status = toStr(state.status);
      const failed = status === 'failed' || status === 'cancelled';
      const output = toStr(state.outputText)
        || toStr(toRecord(state.error)?.message)
        || toStr(state.reason)
        || '';
      const settled = status === 'completed' || failed || status === 'skipped';
      return {
        ...common,
        role: 'assistant',
        parts: [],
        toolCalls: [{ id, name: call.name, input: call.input }],
        ...(settled ? { toolResult: { content: output, isError: failed } } : {}),
      };
    }
    case 'checkpoint': {
      const done = toStr(record.generationStatus) === 'completed';
      if (toStr(record.kind) !== 'compaction' || !done) {
        return { ...common, role: 'checkpoint', parts: [] };
      }
      const newSessionId = toStr(toRecord(record.details)?.newSessionId);
      return { ...common, role: 'checkpoint', parts: [], compaction: newSessionId ? { newSessionId } : {} };
    }
    case 'notice':
    case 'callback':
      return { ...common, role: type, parts: [] };
    default:
      return null;
  }
}

/** Parse a single stream-json NDJSON line. Returns `null` for blank/invalid lines. */
export function parseVibeStreamLine(line: string): VibeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }
  const record = obj as Record<string, unknown>;
  const entryType = toStr(record.type);
  if (entryType) {
    return parseHistoryEntry(record, entryType);
  }
  const role = toStr(record.role);
  if (!role) {
    return null;
  }
  const parts = parseContentParts(record.content);
  // Vibe carries reasoning in a dedicated `reasoning_content` string field
  // (not as a content part); surface it as a leading think part.
  const reasoning = toStr(record.reasoning_content);
  if (reasoning && reasoning.trim()) {
    parts.unshift({ type: 'think', text: reasoning });
  }
  return {
    role: role as VibeEventRole,
    parts,
    toolCalls: parseToolCalls(record.tool_calls),
    toolCallId: toStr(record.tool_call_id),
    raw: record,
  };
}

/** Parse a full stream-json buffer into events (in stream order). */
export function parseVibeStream(buffer: string): VibeStreamEvent[] {
  const events: VibeStreamEvent[] = [];
  for (const line of buffer.split('\n')) {
    const event = parseVibeStreamLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

/** True when the event carries any visible assistant text. */
export function isAssistantTextEvent(event: VibeStreamEvent): boolean {
  return event.role === 'assistant' && event.parts.some((part) => part.type === 'text');
}

/** True when the event carries one or more tool calls. */
export function isToolUseEvent(event: VibeStreamEvent): boolean {
  return event.role === 'assistant' && event.toolCalls.length > 0;
}

/** True when the event is a tool result line. */
export function isToolResultEvent(event: VibeStreamEvent): boolean {
  return event.role === 'tool';
}

/** True when the event carries reasoning ("think") content. */
export function isThinkingEvent(event: VibeStreamEvent): boolean {
  return event.role === 'assistant' && event.parts.some((part) => part.type === 'think');
}

/**
 * Best-effort session id from a stream event.
 *
 * stream-json has no dedicated session line, but defensive support is kept for
 * a `session_id` / `id` field should the wire protocol surface one.
 */
export function isSessionEvent(event: VibeStreamEvent): boolean {
  return (
    typeof event.raw.session_id === 'string'
    && (event.raw.session_id as string).trim().length > 0
  );
}

const SYSTEM_WRAPPER = /^<system>([\s\S]*?)<\/system>$/i;

/** Concatenate visible text parts (ignores reasoning). */
export function joinTextParts(parts: VibeContentPart[]): string {
  return parts
    .filter((part): part is VibeTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

/** Concatenate reasoning parts (ignores visible text). */
export function joinThinkParts(parts: VibeContentPart[]): string {
  return parts
    .filter((part): part is VibeThinkPart => part.type === 'think')
    .map((part) => part.text)
    .join('');
}

/**
 * Render a `role: "tool"` result's text, stripping the leading
 * `<system>...</system>` status wrapper Vibe emits before raw output.
 */
export function renderToolResult(event: VibeStreamEvent): string {
  const segments: string[] = [];
  for (const part of event.parts) {
    if (part.type !== 'text') {
      continue;
    }
    const match = part.text.trim().match(SYSTEM_WRAPPER);
    segments.push(match ? match[1].trim() : part.text);
  }
  return segments.join('\n').trim();
}

/** True when a tool result reports a failure inside its `<system>` wrapper. */
export function isToolResultError(event: VibeStreamEvent): boolean {
  for (const part of event.parts) {
    if (part.type !== 'text') {
      continue;
    }
    const match = part.text.trim().match(SYSTEM_WRAPPER);
    if (match && /\b(error|fail(?:ed|ure)?|exception)\b/i.test(match[1])) {
      return true;
    }
  }
  return false;
}

// Map Vibe's tool names onto the plugin's CANONICAL tool names so the chat
// renderer picks the right icon + input summary (folder-search + pattern for
// Glob, terminal + command for Bash, file icons + filename for Read/Write/Edit),
// matching how Claude, Codex and Antigravity tool cards render. Unknown tools
// fall through to a humanized label so they still read cleanly.
const VIBE_CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  Shell: 'Bash',
  Bash: 'Bash',
  Read: 'Read',
  View: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  MultiEdit: 'Edit',
  Grep: 'Grep',
  Glob: 'Glob',
  LS: 'LS',
  List: 'LS',
  WebSearch: 'WebSearch',
  WebFetch: 'WebFetch',
});

/**
 * Canonical plugin tool name for a Vibe tool (e.g. `Shell` → `Bash`, `Glob` →
 * `Glob`), so the renderer shows the matching icon + summary. Unknown tool names
 * are humanized (e.g. `some_tool` → `Some tool`) as a readable fallback.
 */
export function humanizeVibeTool(name: string): string {
  const canonical = VIBE_CANONICAL_TOOL_NAMES[name];
  if (canonical) {
    return canonical;
  }
  const words = String(name).trim().split(/(?=[A-Z])|[-_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return 'Tool';
  }
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase(),
    )
    .join(' ');
}
