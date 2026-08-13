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

const PATH_AS_FILE_PATH = new Set<string>(['Read', 'View', 'Write', 'Edit', 'MultiEdit']);

const TOOL_NAME_MAP: Record<string, string> = {
  agent: TOOL_SUBAGENT,
  askuserquestion: TOOL_ASK_USER_QUESTION,
  bash: TOOL_BASH,
  browser: TOOL_WEB_FETCH,
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
  const lower = value.trim().toLowerCase();
  return lower in TOOL_NAME_MAP ? TOOL_NAME_MAP[lower] : null;
}

export function normalizeClineAcpToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const name = rawName ?? '';
  if (!PATH_AS_FILE_PATH.has(name)) {
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

function normalizeClineToolUseResult(
  _rawName: string | undefined,
  _input: Record<string, unknown>,
  rawOutput: unknown,
): SDKToolUseResult | undefined {
  if (rawOutput === undefined) {
    return undefined;
  }
  return { output: formatUnknownValue(rawOutput) };
}

function resolveClineRawToolName(
  currentRawName: string | undefined,
  update: { kind?: string | null; title?: string | null },
): string {
  if (currentRawName) {
    return currentRawName;
  }
  return update.title?.trim() || update.kind?.trim() || 'tool';
}

export function normalizeClineAcpToolName(rawName: string | undefined): string {
  return toKnownToolName(rawName) ?? humanizeToolName(rawName);
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

export function createClineAcpToolStreamAdapter(): AcpToolStreamAdapter {
  const adapter: AcpToolStreamPresentationAdapter = {
    normalizeToolInput: normalizeClineAcpToolInput,
    normalizeToolName: normalizeClineAcpToolName,
    normalizeToolUseResult: normalizeClineToolUseResult,
    resolveRawToolName: resolveClineRawToolName,
  };
  return new AcpToolStreamAdapter(adapter);
}
