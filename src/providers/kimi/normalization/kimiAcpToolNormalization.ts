import {
  TOOL_AGENT_OUTPUT,
  TOOL_ASK_USER_QUESTION,
  TOOL_BASH,
  TOOL_EDIT,
  TOOL_GLOB,
  TOOL_GREP,
  TOOL_READ,
  TOOL_SUBAGENT,
  TOOL_SUBAGENT_LEGACY,
  TOOL_TODO_WRITE,
  TOOL_WEB_FETCH,
  TOOL_WEB_SEARCH,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import type { SDKToolUseResult } from '../../../core/types/diff';
import { AcpToolStreamAdapter, type AcpToolStreamPresentationAdapter } from '../../acp';

/** Tools that address files via Kimi's `path` argument (the plugin expects `file_path`). */
const KIMI_PATH_AS_FILE_PATH = new Set<string>(['Read', 'View', 'Write', 'Edit', 'MultiEdit']);

const TOOL_NAME_MAP: Record<string, string> = {
  agent: TOOL_SUBAGENT,
  askuserquestion: TOOL_ASK_USER_QUESTION,
  bash: TOOL_BASH,
  edit: TOOL_EDIT,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  list: TOOL_GLOB,
  ls: TOOL_GLOB,
  multiedit: TOOL_EDIT,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  shell: TOOL_BASH,
  task: TOOL_SUBAGENT_LEGACY,
  taskoutput: TOOL_AGENT_OUTPUT,
  todo_write: TOOL_TODO_WRITE,
  todowrite: TOOL_TODO_WRITE,
  view: TOOL_READ,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
};

function toKnownToolName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  return lower in TOOL_NAME_MAP ? TOOL_NAME_MAP[lower] : null;
}

export function normalizeKimiAcpToolInput(rawName: string | undefined, input: Record<string, unknown>): Record<string, unknown> {
  const name = rawName ?? '';
  if (!KIMI_PATH_AS_FILE_PATH.has(name)) {
    return input;
  }

  const path = input.path;
  if (typeof path !== 'string' || !path.trim()) {
    return input;
  }

  const next: Record<string, unknown> = { ...input };
  delete next.path;
  next.file_path = path;
  return next;
}

function normalizeKimiToolUseResult(_rawName: string | undefined, _input: Record<string, unknown>, rawOutput: unknown): SDKToolUseResult | undefined {
  if (rawOutput === undefined) {
    return undefined;
  }

  return { output: formatUnknownValue(rawOutput) };
}

function resolveKimiRawToolName(
  currentRawName: string | undefined,
  update: {
    kind?: string | null;
    title?: string | null;
  },
): string {
  if (currentRawName) {
    return currentRawName;
  }

  return update.title?.trim() || update.kind?.trim() || 'tool';
}

export function normalizeKimiAcpToolName(rawName: string | undefined): string {
  const knownName = toKnownToolName(rawName);
  if (knownName) {
    return knownName;
  }

  return humanizeToolName(rawName);
}

function humanizeToolName(name: string | undefined): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return 'Tool';
  }

  const words = trimmed.split(/(?=[A-Z])|[-_\s]+/).filter(Boolean);
  if (words.length === 0) {
    return 'Tool';
  }

  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.toLowerCase(),
    )
    .join(' ');
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`;
  }
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '[unserializable]';
  }
}

export function createKimiAcpToolStreamAdapter(): AcpToolStreamAdapter {
  const adapter: AcpToolStreamPresentationAdapter = {
    normalizeToolInput: normalizeKimiAcpToolInput,
    normalizeToolName: normalizeKimiAcpToolName,
    normalizeToolUseResult: normalizeKimiToolUseResult,
    resolveRawToolName: resolveKimiRawToolName,
  };

  return new AcpToolStreamAdapter(adapter);
}
