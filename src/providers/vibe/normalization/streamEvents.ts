/**
 * Parsing + classification for Vibe CLI's `--output-format stream-json` output.
 *
 * CRITICAL (live-probed vibe-cli v1.47): unlike Claude Code / Codex stream-json
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
