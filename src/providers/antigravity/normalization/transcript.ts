/**
 * Parsing + classification for Antigravity's per-conversation transcript:
 *   ~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl
 *
 * Each line is one JSON event. Verified fields (agy v1.0.3):
 *   step_index, source, type, status, created_at, content
 *
 * This module is intentionally decoupled from the plugin's internal stream
 * types: it turns raw JSONL lines into a small, stable shape that the runtime
 * adapter maps onto chat chunks. Unknown event types pass through untouched.
 */

export type AntigravityEventSource =
  | 'USER_EXPLICIT'
  | 'USER_IMPLICIT'
  | 'SYSTEM'
  | 'MODEL'
  | 'TOOL'
  | (string & {});

export type AntigravityEventType =
  | 'USER_INPUT'
  | 'CONVERSATION_HISTORY'
  | 'PLANNER_RESPONSE'
  | 'TOOL_CALL'
  | 'TOOL_RESULT'
  | 'INVOKE_SUBAGENT'
  | (string & {});

export type AntigravityEventStatus = 'PENDING' | 'RUNNING' | 'DONE' | (string & {});

export interface AntigravityTranscriptEvent {
  stepIndex: number;
  source: AntigravityEventSource;
  type: AntigravityEventType;
  status: AntigravityEventStatus;
  createdAt?: string;
  content?: string;
  /** Original parsed object, for fields not yet modelled. */
  raw: Record<string, unknown>;
}

function toStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toNum(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1;
}

/** Parse a single transcript JSONL line. Returns `null` for blank/invalid lines. */
export function parseTranscriptLine(line: string): AntigravityTranscriptEvent | null {
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
  const type = toStr(record.type);
  if (!type) {
    return null;
  }
  return {
    stepIndex: toNum(record.step_index),
    source: (toStr(record.source) ?? 'SYSTEM') as AntigravityEventSource,
    type: type as AntigravityEventType,
    status: (toStr(record.status) ?? 'DONE') as AntigravityEventStatus,
    createdAt: toStr(record.created_at),
    content: toStr(record.content),
    raw: record,
  };
}

/** Parse a full transcript buffer into events (in file order). */
export function parseTranscript(buffer: string): AntigravityTranscriptEvent[] {
  const events: AntigravityTranscriptEvent[] = [];
  for (const line of buffer.split('\n')) {
    const event = parseTranscriptLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

/** Assistant-visible model text (the planner's natural-language response). */
export function isAssistantTextEvent(event: AntigravityTranscriptEvent): boolean {
  return event.source === 'MODEL' && event.type === 'PLANNER_RESPONSE' && !!event.content;
}

/**
 * Removes agy's verbose trailing recap that it appends to every reply, e.g.:
 *
 *   <answer>
 *
 *   ***
 *
 *   ### Summary of Actions
 *   * Scanned the workspace ...
 *
 * The heading text is localized (`Summary of Actions`, `Zusammenfassung`, …), so
 * we key off the structural signature instead: a trailing `***` thematic break
 * whose next non-blank line is a markdown heading. That recap restates what the
 * tool cards already show and is pure clutter in a chat transcript.
 *
 * Drops the LAST `***`+heading recap block, plus a trailing `***` followed only
 * by blank lines (a dangling divider, or a recap whose heading has not streamed
 * in yet — this also stops the live append-only text stream from emitting an
 * orphaned `***` it could never retract). A `***` followed by real non-heading
 * content is a genuine in-body divider and is kept.
 */
export function stripAgyTrailingRecap(content: string): string {
  if (!content) {
    return content;
  }
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '***') {
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') {
      j++;
    }
    if (j < lines.length) {
      // Content follows the `***`. Strip the whole block only when that content
      // is agy's recap heading; otherwise it's a genuine in-body divider — keep.
      return /^#{1,6}\s+\S/.test(lines[j].trim())
        ? lines.slice(0, i).join('\n').replace(/\s+$/, '')
        : content;
    }
    // Only blank lines (or nothing) follow the `***`: a trailing divider or a
    // recap whose heading has not arrived yet — drop it.
    return lines.slice(0, i).join('\n').replace(/\s+$/, '');
  }
  return content;
}

/**
 * Tool activity events.
 *
 * agy v1.0.3 does NOT use `TOOL_CALL`/`TOOL_RESULT`. Instead every concrete
 * action the model takes is its own `MODEL`-sourced step whose `type` names the
 * action (`RUN_COMMAND`, `VIEW_FILE`, `EDIT_FILE`, `GREP_SEARCH`, `SEARCH_WEB`,
 * `GENERIC`, …) and whose `content` carries the formatted result. The step
 * grows through a `RUNNING` → `DONE`/`ERROR` lifecycle under one `step_index`.
 *
 * Treating "any `MODEL` step that is not the planner narration" as a tool event
 * is future-proof: new action types render without a code change. The legacy
 * `TOOL_*` / `source: 'TOOL'` shapes are still accepted defensively.
 */
export function isToolEvent(event: AntigravityTranscriptEvent): boolean {
  if (event.source === 'MODEL') {
    return Boolean(event.type) && event.type !== 'PLANNER_RESPONSE';
  }
  return (
    event.type === 'TOOL_CALL' ||
    event.type === 'TOOL_RESULT' ||
    event.type === 'INVOKE_SUBAGENT' ||
    event.source === 'TOOL'
  );
}

/**
 * Echoed user input and internal bookkeeping the live chat UI already owns.
 *
 * `SYSTEM`/`USER_*`-sourced events (CONVERSATION_HISTORY, SYSTEM_MESSAGE,
 * ERROR_MESSAGE, the user echo) are internal to agy's planner loop and must not
 * surface as assistant content while tailing.
 */
export function isIgnorableEvent(event: AntigravityTranscriptEvent): boolean {
  return (
    event.type === 'USER_INPUT' ||
    event.type === 'CONVERSATION_HISTORY' ||
    event.source === 'SYSTEM' ||
    event.source === 'USER_EXPLICIT' ||
    event.source === 'USER_IMPLICIT'
  );
}

/** A tool step has reached a terminal state (its result is final). */
export function isToolTerminalStatus(status: AntigravityEventStatus): boolean {
  return status === 'DONE' || status === 'ERROR' || status === 'FAILED' || status === 'COMPLETED';
}

/** A tool step ended in failure. */
export function isToolErrorStatus(status: AntigravityEventStatus): boolean {
  return status === 'ERROR' || status === 'FAILED';
}

const TOOL_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  RUN_COMMAND: 'Run command',
  VIEW_FILE: 'View file',
  READ_FILE: 'Read file',
  EDIT_FILE: 'Edit file',
  WRITE_FILE: 'Write file',
  PROPOSE_CODE: 'Propose code',
  LIST_DIRECTORY: 'List directory',
  GREP_SEARCH: 'Grep search',
  FIND_FILES: 'Find files',
  SEARCH_WEB: 'Web search',
  READ_URL: 'Read URL',
  EXECUTE_URL: 'Open URL',
  INVOKE_SUBAGENT: 'Subagent',
  GENERIC: 'Action',
});

/** Human-friendly tool name for an agy action type (e.g. `RUN_COMMAND` → `Run command`). */
export function humanizeToolType(type: AntigravityEventType): string {
  const known = TOOL_TYPE_LABELS[type];
  if (known) {
    return known;
  }
  const words = String(type).toLowerCase().split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return 'Action';
  }
  return words
    .map((word, index) => (index === 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

const TOOL_HEADER_LINE = /^(Created At|Completed At|Total Lines|Total Bytes):/i;

/**
 * Strips agy's verbose result header (the `Created At:` / `Completed At:` /
 * size lines) and leading tab indentation so the tool result reads cleanly.
 */
export function cleanToolContent(content: string | undefined): string {
  if (!content) {
    return '';
  }
  const lines = content.split('\n');
  const kept: string[] = [];
  let droppingHeader = true;
  for (const line of lines) {
    if (droppingHeader && (TOOL_HEADER_LINE.test(line.trim()) || line.trim() === '')) {
      continue;
    }
    droppingHeader = false;
    kept.push(line.replace(/^\t+/, ''));
  }
  return kept.join('\n').trim();
}

/** Extract a compact tool input (e.g. a file path) without dumping the result blob. */
export function toolInputFromContent(event: AntigravityTranscriptEvent): Record<string, unknown> {
  const content = event.content ?? '';
  const pathMatch = content.match(/File Path:\s*`?(?:file:\/\/)?([^`\n]+)`?/i);
  if (pathMatch) {
    return { path: pathMatch[1].trim() };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Planner `tool_calls` correlation (verified shape, probe 2026-06-15)
//
// agy carries the *input* for each concrete action (command string, file path,
// edit text) NOT in the MODEL tool step's `content` (that is the RESULT), but in
// the `tool_calls` array of the PLANNER_RESPONSE event that immediately precedes
// it. Each entry is `{ name, args }` where the `args` values are JSON
// double-encoded strings, e.g. `"CommandLine": "\"git status\""`.
// ---------------------------------------------------------------------------

/** A single agy planner tool call (input side of a tool step). */
export interface AntigravityToolCall {
  /** Lowercase snake action name, e.g. `run_command`, `view_file`, `edit_file`. */
  name: string;
  /** Decoded args (one layer of JSON quoting stripped). */
  args: Record<string, unknown>;
}

/**
 * Decodes a single agy arg value. agy double-encodes string args
 * (`"\"git status\""` → `git status`); numbers/bools may arrive as bare JSON.
 * Falls back to the raw value when it is not a JSON-quoted string.
 */
export function decodeAgyArg(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    /^-?\d+(\.\d+)?$/.test(trimmed) ||
    trimmed === 'true' ||
    trimmed === 'false' ||
    trimmed === 'null'
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') {
        return parsed;
      }
    } catch {
      // Not valid JSON after all; fall through to the raw string.
    }
  }
  return value;
}

function decodeAgyArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    result[key] = decodeAgyArg(value);
  }
  return result;
}

/**
 * Parses the `tool_calls` array off a PLANNER_RESPONSE event, decoding each
 * entry's args. Returns `[]` for events without a usable `tool_calls` array so
 * unknown shapes never crash the tailer.
 */
export function parsePlannerToolCalls(event: AntigravityTranscriptEvent): AntigravityToolCall[] {
  const raw = event.raw.tool_calls;
  if (!Array.isArray(raw)) {
    return [];
  }
  const calls: AntigravityToolCall[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = toStr(record.name);
    if (!name) {
      continue;
    }
    calls.push({ name, args: decodeAgyArgs(record.args) });
  }
  return calls;
}

/** True when a PLANNER_RESPONSE event carries actionable tool calls. */
export function hasPlannerToolCalls(event: AntigravityTranscriptEvent): boolean {
  return event.type === 'PLANNER_RESPONSE' && Array.isArray(event.raw.tool_calls);
}

const firstNonEmpty = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

/**
 * Maps an agy action (planner `tool_calls[].name`, lowercase snake) onto a
 * canonical Claudian tool name so the chat renderer can show a rich card (diff /
 * command / file / search / subagent) instead of a generic one. Unknown actions
 * return `undefined` and fall back to the humanized label.
 */
const CANONICAL_TOOL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  run_command: 'Bash',
  view_file: 'Read',
  read_file: 'Read',
  list_dir: 'LS',
  list_directory: 'LS',
  edit_file: 'Edit',
  replace_file_content: 'Edit',
  propose_code: 'Edit',
  write_file: 'Write',
  create_file: 'Write',
  grep_search: 'Grep',
  find_files: 'Glob',
  search_web: 'WebSearch',
  read_url: 'WebFetch',
  read_url_content: 'WebFetch',
  invoke_subagent: 'Agent',
  spawn_agent: 'Agent',
});

export function canonicalToolName(action: string): string | undefined {
  if (!action) {
    return undefined;
  }
  return CANONICAL_TOOL_NAMES[action.toLowerCase()];
}

/**
 * Builds the canonical tool input for a MODEL tool step, merging the decoded
 * planner args (preferred — they hold the real command/path/edit text) with a
 * `File Path:` fallback parsed from the event content.
 *
 * The output keys match what the chat renderers read: `command`/`cwd` (Bash),
 * `file_path`/`old_string`/`new_string`/`content` (Edit/Write), `path` (Read/LS),
 * `pattern` (Grep/Glob), `query`/`url` (WebSearch/WebFetch).
 */
export function buildToolInput(
  event: AntigravityTranscriptEvent,
  call: AntigravityToolCall | undefined,
): Record<string, unknown> {
  const fromContent = toolInputFromContent(event);
  if (!call) {
    return fromContent;
  }
  const a = call.args;
  const action = call.name.toLowerCase();
  const filePath = firstNonEmpty(a.AbsolutePath, a.TargetFile, a.FilePath, a.Path);
  const input: Record<string, unknown> = {};

  switch (action) {
    case 'run_command': {
      const command = firstNonEmpty(a.CommandLine, a.Command, a.command);
      if (command) input.command = command;
      const cwd = firstNonEmpty(a.Cwd, a.cwd);
      if (cwd) input.cwd = cwd;
      break;
    }
    case 'view_file':
    case 'read_file': {
      if (filePath) input.file_path = filePath;
      break;
    }
    case 'list_dir':
    case 'list_directory': {
      const dir = firstNonEmpty(a.DirectoryPath, a.Path, a.AbsolutePath);
      if (dir) input.path = dir;
      break;
    }
    case 'edit_file':
    case 'replace_file_content':
    case 'propose_code': {
      if (filePath) input.file_path = filePath;
      const oldStr = firstNonEmpty(a.old_string, a.OldString, a.TargetContent, a.Before);
      const newStr = firstNonEmpty(a.new_string, a.NewString, a.CodeEdit, a.ReplacementChunks, a.After, a.Content);
      if (typeof oldStr === 'string') input.old_string = oldStr;
      if (typeof newStr === 'string') input.new_string = newStr;
      break;
    }
    case 'write_file':
    case 'create_file': {
      if (filePath) input.file_path = filePath;
      const content = firstNonEmpty(a.Content, a.content, a.CodeContent, a.FileContent);
      if (typeof content === 'string') input.content = content;
      break;
    }
    case 'grep_search': {
      const pattern = firstNonEmpty(a.Query, a.Pattern, a.SearchTerm, a.query);
      if (pattern) input.pattern = pattern;
      break;
    }
    case 'find_files': {
      const pattern = firstNonEmpty(a.Pattern, a.Query, a.Glob);
      if (pattern) input.pattern = pattern;
      break;
    }
    case 'search_web': {
      const query = firstNonEmpty(a.Query, a.query, a.SearchTerm);
      if (query) input.query = query;
      break;
    }
    case 'read_url':
    case 'read_url_content': {
      const url = firstNonEmpty(a.Url, a.URL, a.url);
      if (url) input.url = url;
      break;
    }
    default: {
      // Unknown action: surface whatever path/command-ish args exist so the
      // generic card is still informative, and never crash.
      if (filePath) input.file_path = filePath;
      const command = firstNonEmpty(a.CommandLine, a.Command);
      if (command) input.command = command;
      break;
    }
  }

  // Fall back to the content-derived path hint when no arg yielded input.
  if (Object.keys(input).length === 0 && fromContent.path) {
    return fromContent;
  }
  return input;
}

/** A human description for a tool step, from the planner's `toolAction`/`toolSummary`. */
export function toolDescriptionFromCall(call: AntigravityToolCall | undefined): string | undefined {
  if (!call) {
    return undefined;
  }
  return firstNonEmpty(
    call.args.toolAction,
    call.args.ToolAction,
    call.args.toolSummary,
    call.args.ToolSummary,
  );
}

/** True when agy flagged the event's `content` as truncated. */
export function isContentTruncated(event: AntigravityTranscriptEvent): boolean {
  const flagged = event.raw.truncated_fields;
  return Array.isArray(flagged) && flagged.some((f) => f === 'content');
}

// ---------------------------------------------------------------------------
// Thinking + subagent detection (defensive — not observed live, must not crash)
// ---------------------------------------------------------------------------

/** Reasoning text carried on an event, if any (`thinking` / `reasoning`). */
export function extractEventThinking(event: AntigravityTranscriptEvent): string | undefined {
  return firstNonEmpty(event.raw.thinking, event.raw.reasoning);
}

/** Reference to a subagent an event belongs to / spawns. */
export interface AntigravitySubagentRef {
  id: string;
  description: string;
}

/**
 * Detects whether an event denotes a subagent step. agy did not emit nested
 * subagent events in probing, so this is defensive: it recognizes an
 * `INVOKE_SUBAGENT`/`SUBAGENT` type, a `spawn_agent` planner call, or any event
 * carrying a `subagent_id` / `agent_id` / `parent_step_index` field.
 */
export function isSubagentEvent(
  event: AntigravityTranscriptEvent,
  call?: AntigravityToolCall,
): boolean {
  const type = String(event.type).toUpperCase();
  if (type === 'INVOKE_SUBAGENT' || type === 'SUBAGENT' || type.includes('SUBAGENT')) {
    return true;
  }
  if (call) {
    const callName = call.name.toLowerCase();
    if (callName === 'spawn_agent' || callName === 'invoke_subagent') {
      return true;
    }
  }
  const raw = event.raw;
  return (
    typeof raw.subagent_id === 'string' ||
    typeof raw.agent_id === 'string' ||
    typeof raw.parent_step_index === 'number'
  );
}

/** Subagent id + description for an event (defensive across known field shapes). */
export function subagentRefFromEvent(
  event: AntigravityTranscriptEvent,
  call?: AntigravityToolCall,
): AntigravitySubagentRef {
  const raw = event.raw;
  const id =
    firstNonEmpty(raw.subagent_id, raw.agent_id) ??
    (typeof raw.parent_step_index === 'number'
      ? `agy-subagent-${raw.parent_step_index}`
      : `agy-subagent-${event.stepIndex}`);
  const description =
    toolDescriptionFromCall(call) ??
    firstNonEmpty(raw.subagent_description, raw.description) ??
    'Subagent';
  return { id, description };
}

/** Strip Antigravity's `<USER_REQUEST>`/metadata wrappers from echoed input. */
export function unwrapUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return (match ? match[1] : content).trim();
}
