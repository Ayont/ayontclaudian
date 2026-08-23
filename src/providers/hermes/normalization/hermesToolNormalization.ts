/**
 * Hermes tool-call presentation.
 *
 * `acp_adapter/tools.py` sends `raw_input=None` for every "polished" tool, so
 * the only identity on the wire is the human title plus the ACP `kind`. The
 * titles follow a fixed grammar built by `build_tool_title` — `"terminal: …"`,
 * `"read: …"`, `"patch (replace): …"`, `"web search: …"`, `"skill view (…)"` —
 * which is what the prefix table below decodes back into a tool name.
 */

import {
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SKILL,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { type AcpToolCall, AcpToolStreamAdapter } from '../../acp';

/** Hermes tool name → Claudian's canonical tool name. */
const TOOL_NAME_MAP: Record<string, string> = {
  browser_navigate: TOOL_WEB_FETCH,
  delegate_task: TOOL_TASK,
  execute_code: TOOL_BASH,
  patch: TOOL_EDIT,
  read_file: TOOL_READ,
  search_files: TOOL_GREP,
  skill_manage: TOOL_SKILL,
  skill_view: TOOL_SKILL,
  skills_list: TOOL_SKILL,
  terminal: TOOL_BASH,
  todo: TOOL_TODO_WRITE,
  web_extract: TOOL_WEB_FETCH,
  web_search: TOOL_WEB_SEARCH,
  write_file: TOOL_WRITE,
};

/**
 * Title prefix → Hermes tool name. Ordered longest-first at lookup time so
 * `"web search"` never loses to a shorter prefix.
 */
const TITLE_PREFIX_TO_TOOL: Record<string, string> = {
  'analyze image': 'vision_analyze',
  'browser images': 'browser_get_images',
  'browser snapshot': 'browser_snapshot',
  'browser vision': 'browser_vision',
  cron: 'cronjob',
  delegate: 'delegate_task',
  'delegate batch': 'delegate_task',
  'delegate task': 'delegate_task',
  extract: 'web_extract',
  'generate image': 'image_generate',
  memory: 'memory',
  navigate: 'browser_navigate',
  patch: 'patch',
  process: 'process',
  python: 'execute_code',
  'python code': 'execute_code',
  read: 'read_file',
  'recent sessions': 'session_search',
  search: 'search_files',
  'session search': 'session_search',
  skill: 'skill_manage',
  'skill view': 'skill_view',
  'skills list': 'skills_list',
  terminal: 'terminal',
  todo: 'todo',
  'web extract': 'web_extract',
  'web search': 'web_search',
  write: 'write_file',
};

const TITLE_PREFIXES_LONGEST_FIRST = Object.keys(TITLE_PREFIX_TO_TOOL)
  .sort((left, right) => right.length - left.length);

const KIND_FALLBACK_TOOL: Record<string, string> = {
  edit: 'write_file',
  execute: 'terminal',
  fetch: 'web_search',
  read: 'read_file',
  search: 'search_files',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstTrimmedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Strips the argument tail from a Hermes tool title. `"patch (replace): x"`
 * and `"process manage: sid"` both reduce to their leading tool words.
 */
export function extractHermesTitlePrefix(title: string | null | undefined): string {
  const trimmed = title?.trim();
  if (!trimmed) {
    return '';
  }

  const colonIndex = trimmed.indexOf(':');
  const head = colonIndex >= 0 ? trimmed.slice(0, colonIndex) : trimmed;
  const parenIndex = head.indexOf('(');
  return (parenIndex >= 0 ? head.slice(0, parenIndex) : head).trim().toLowerCase();
}

export function resolveHermesRawToolName(
  currentRawName: string | undefined,
  update: {
    kind?: string | null;
    title?: string | null;
  },
): string {
  const prefix = extractHermesTitlePrefix(update.title);
  if (prefix) {
    // Exact prefix first, then longest matching leading token run — the latter
    // covers titles whose prefix carries an argument word (`process manage`).
    const exact = TITLE_PREFIX_TO_TOOL[prefix];
    if (exact) {
      return exact;
    }

    const matched = TITLE_PREFIXES_LONGEST_FIRST.find((candidate) => (
      prefix === candidate || prefix.startsWith(`${candidate} `)
    ));
    if (matched) {
      return TITLE_PREFIX_TO_TOOL[matched];
    }
  }

  if (currentRawName) {
    return currentRawName;
  }

  const kindFallback = update.kind ? KIND_FALLBACK_TOOL[update.kind] : undefined;
  return kindFallback ?? prefix ?? 'tool';
}

/**
 * Recovers a tool's arguments from its title.
 *
 * `acp_adapter/tools.py` sends `raw_input=None` for every polished tool, so
 * without this the tool card would render with an empty input — no command, no
 * path. The title is the only carrier left. Note Hermes truncates long values
 * (80 chars for a shell command), so the result is display-grade, not a
 * faithful copy of what the model asked for.
 */
export function deriveHermesToolInputFromTitle(
  rawName: string,
  title: string | null | undefined,
): Record<string, unknown> {
  const trimmed = title?.trim();
  if (!trimmed) {
    return {};
  }

  const colonIndex = trimmed.indexOf(':');
  const head = colonIndex >= 0 ? trimmed.slice(0, colonIndex).trim() : trimmed;
  const tail = colonIndex >= 0 ? trimmed.slice(colonIndex + 1).trim() : '';
  const qualifier = head.match(/\(([^)]*)\)\s*$/)?.[1]?.trim();
  // `process manage: sid` / `memory store: target` carry the action as the
  // second word of the head rather than in parentheses.
  const headWords = head.replace(/\([^)]*\)\s*$/, '').trim().split(/\s+/);
  const action = headWords.length > 1 ? headWords[headWords.length - 1] : '';

  switch (rawName) {
    case 'terminal':
      return tail ? { command: tail } : {};
    case 'execute_code':
      return tail ? { command: tail } : {};
    case 'read_file':
    case 'write_file':
      return tail ? { path: tail } : {};
    case 'patch':
      return {
        ...(tail ? { path: tail } : {}),
        ...(qualifier ? { mode: qualifier } : {}),
      };
    case 'search_files':
      return tail ? { pattern: tail } : {};
    case 'web_search':
    case 'session_search':
      return tail ? { query: tail } : {};
    case 'web_extract':
    case 'browser_navigate':
      return tail ? { url: tail } : {};
    case 'delegate_task':
      return tail ? { goal: tail } : {};
    case 'skill_view':
    case 'skills_list':
      return qualifier ? { name: qualifier } : {};
    case 'skill_manage':
      return {
        ...(tail ? { name: tail } : {}),
        ...(action ? { action } : {}),
      };
    case 'memory':
      return {
        ...(action ? { action } : {}),
        ...(tail ? { target: tail } : {}),
      };
    case 'process':
      return {
        ...(action ? { action } : {}),
        ...(tail ? { session_id: tail } : {}),
      };
    case 'cronjob':
      return {
        ...(action ? { action } : {}),
        ...(tail ? { job_id: tail } : {}),
      };
    case 'vision_analyze':
    case 'browser_vision':
      return tail ? { question: tail } : {};
    case 'image_generate':
      return tail ? { prompt: tail } : {};
    default:
      return {};
  }
}

export function normalizeHermesToolName(rawName: string | undefined): string {
  const normalized = rawName?.trim().toLowerCase();
  if (!normalized) {
    return 'tool';
  }

  return TOOL_NAME_MAP[normalized] ?? normalized;
}

/**
 * Maps Hermes' argument names onto the shapes Claudian's tool renderers read
 * (`file_path`, `command`, `pattern`, …). Only reached for unpolished tools,
 * which are the ones that actually ship `rawInput`.
 */
export function normalizeHermesToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (rawName) {
    case 'read_file':
      return {
        ...(firstTrimmedString(input.path, input.file_path)
          ? { file_path: firstTrimmedString(input.path, input.file_path) }
          : {}),
        ...(typeof input.limit === 'number' ? { limit: input.limit } : {}),
        ...(typeof input.offset === 'number' ? { offset: input.offset } : {}),
      };
    case 'write_file':
      return {
        ...(typeof input.content === 'string' ? { content: input.content } : {}),
        ...(firstTrimmedString(input.path, input.file_path)
          ? { file_path: firstTrimmedString(input.path, input.file_path) }
          : {}),
      };
    case 'patch':
      return {
        ...(firstTrimmedString(input.path, input.file_path)
          ? { file_path: firstTrimmedString(input.path, input.file_path) }
          : {}),
        ...(firstTrimmedString(input.mode) ? { mode: firstTrimmedString(input.mode) } : {}),
        ...(typeof input.old_text === 'string' ? { old_string: input.old_text } : {}),
        ...(typeof input.new_text === 'string' ? { new_string: input.new_text } : {}),
      };
    case 'terminal':
      return {
        ...(typeof input.command === 'string' ? { command: input.command } : {}),
        ...(firstTrimmedString(input.cwd) ? { cwd: firstTrimmedString(input.cwd) } : {}),
      };
    case 'execute_code':
      return typeof input.code === 'string' ? { command: input.code } : input;
    case 'search_files':
      return {
        ...(firstTrimmedString(input.pattern) ? { pattern: firstTrimmedString(input.pattern) } : {}),
        ...(firstTrimmedString(input.path) ? { path: firstTrimmedString(input.path) } : {}),
      };
    case 'web_search':
      return firstTrimmedString(input.query) ? { query: firstTrimmedString(input.query) } : {};
    case 'delegate_task':
      return {
        ...(firstTrimmedString(input.goal) ? { prompt: firstTrimmedString(input.goal) } : {}),
        ...(firstTrimmedString(input.description)
          ? { description: firstTrimmedString(input.description) }
          : {}),
      };
    case 'skill_view':
    case 'skill_manage':
      return firstTrimmedString(input.name) ? { skill: firstTrimmedString(input.name) } : {};
    default:
      return input;
  }
}

export function normalizeHermesToolUseResult(
  rawName: string | undefined,
  input: Record<string, unknown>,
  rawOutput: unknown,
): SDKToolUseResult | undefined {
  if (rawName !== 'write_file' && rawName !== 'patch') {
    return undefined;
  }

  const metadata = isPlainObject(rawOutput) && isPlainObject(rawOutput.metadata)
    ? rawOutput.metadata
    : null;
  const filePath = firstTrimmedString(
    input.file_path,
    input.path,
    metadata?.path,
    metadata?.file_path,
  );

  return filePath ? { filePath } : undefined;
}

/**
 * Fills in a tool call's missing `rawInput` from its title so the tool card has
 * something to show. Only applied to the opening `tool_call`: synthesizing it on
 * an update would make the shared adapter emit a duplicate `tool_use` chunk.
 */
export function enrichHermesToolCall(toolCall: AcpToolCall): AcpToolCall {
  if (toolCall.rawInput !== undefined) {
    return toolCall;
  }

  const rawName = resolveHermesRawToolName(undefined, {
    kind: toolCall.kind,
    title: toolCall.title,
  });
  const derived = deriveHermesToolInputFromTitle(rawName, toolCall.title);
  return Object.keys(derived).length > 0 ? { ...toolCall, rawInput: derived } : toolCall;
}

export function createHermesToolStreamAdapter(): AcpToolStreamAdapter {
  return new AcpToolStreamAdapter({
    normalizeToolInput: normalizeHermesToolInput,
    normalizeToolName: normalizeHermesToolName,
    normalizeToolUseResult: normalizeHermesToolUseResult,
    resolveRawToolName: resolveHermesRawToolName,
  });
}
