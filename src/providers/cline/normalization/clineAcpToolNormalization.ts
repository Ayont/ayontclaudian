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
  askfollowupquestion: TOOL_ASK_USER_QUESTION,
  askuserquestion: TOOL_ASK_USER_QUESTION,
  attemptcompletion: 'Ergebnis',
  bash: TOOL_BASH,
  browser: TOOL_WEB_FETCH,
  browseraction: TOOL_WEB_FETCH,
  edit: TOOL_EDIT,
  editor: TOOL_WRITE,
  glob: TOOL_GLOB,
  grep: TOOL_GREP,
  list: TOOL_GLOB,
  listfiles: TOOL_GLOB,
  ls: TOOL_GLOB,
  multiedit: TOOL_EDIT,
  question: TOOL_ASK_USER_QUESTION,
  read: TOOL_READ,
  readfile: TOOL_READ,
  readfiles: TOOL_READ,
  runcommands: TOOL_BASH,
  searchfiles: TOOL_GREP,
  shell: TOOL_BASH,
  submitandexit: 'Ergebnis',
  task: TOOL_SUBAGENT_LEGACY,
  taskoutput: TOOL_AGENT_OUTPUT,
  todo_write: TOOL_TODO_WRITE,
  todowrite: TOOL_TODO_WRITE,
  view: TOOL_READ,
  webfetch: TOOL_WEB_FETCH,
  websearch: TOOL_WEB_SEARCH,
  write: TOOL_WRITE,
  writetofile: TOOL_WRITE,
};

function toKnownToolName(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const lower = value.trim().toLowerCase().replace(/[_-\s]/g, '');
  return lower in TOOL_NAME_MAP ? TOOL_NAME_MAP[lower] : null;
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function firstPathFromFiles(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const path = firstString((entry as Record<string, unknown>).path)
        ?? firstString((entry as Record<string, unknown>).file_path);
      if (path) {
        return path;
      }
    }
  }
  return undefined;
}

function firstCommand(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      return entry;
    }
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const command = firstString((entry as Record<string, unknown>).command)
        ?? firstString((entry as Record<string, unknown>).cmd);
      if (command) {
        return command;
      }
    }
  }
  return undefined;
}

export function normalizeClineAcpToolInput(
  rawName: string | undefined,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const key = String(rawName ?? '').trim().toLowerCase().replace(/[_-\s]/g, '');
  const next: Record<string, unknown> = { ...input };

  const filePath = firstString(input.file_path)
    ?? firstString(input.path)
    ?? firstPathFromFiles(input.files);
  if (filePath && !firstString(next.file_path)) {
    next.file_path = filePath;
  }

  const command = firstString(input.command) ?? firstCommand(input.commands);
  if (command && !firstString(next.command)) {
    next.command = command;
  }

  const contents = firstString(input.contents)
    ?? firstString(input.new_text)
    ?? firstString(input.new_string)
    ?? firstString(input.content);
  if (contents && !firstString(next.contents)) {
    next.contents = contents;
  }

  if (key === 'editor' && firstString(input.old_string)) {
    next.old_string = input.old_string;
  }

  if (PATH_AS_FILE_PATH.has(rawName ?? '') && firstString(input.path) && !firstString(input.file_path)) {
    delete next.path;
    next.file_path = input.path;
  }

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
