import * as fs from 'node:fs';

import { isWriteEditTool } from '../../../core/tools/toolNames';
import type { ChatMessage, ContentBlock, ToolCallInfo } from '../../../core/types';
import { extractUserQuery } from '../../../utils/context';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeHermesToolInput,
  normalizeHermesToolName,
  normalizeHermesToolUseResult,
} from '../normalization/hermesToolNormalization';
import { resolveExistingHermesStateDbPath } from '../runtime/HermesPaths';
import type { HermesProviderState } from '../types';
import { loadHermesSessionRows, type StoredRow } from './HermesSqliteReader';

export { HERMES_MESSAGE_ROW_SQL } from './HermesSqliteReader';

const HERMES_HYDRATION_DIAGNOSTIC_ID_PREFIX = 'hermes-hydration-error';

/** Matches the preamble `buildHermesPrompt` prepends to a session's first turn. */
const VAULT_PROMPT_PATTERN =
  /^<claudian-vault-instructions>[\s\S]*?<\/claudian-vault-instructions>\s*/;

interface HermesToolCallRecord {
  arguments: Record<string, unknown>;
  id: string;
  rawName: string;
}

export async function loadHermesSessionMessages(
  sessionId: string,
  providerState?: HermesProviderState,
): Promise<ChatMessage[]> {
  const databasePath = resolveExistingHermesStateDbPath(providerState?.statePath);
  if (!databasePath || !fs.existsSync(databasePath)) {
    return [];
  }

  const rows = await loadHermesSessionRows(databasePath, sessionId);
  if (!rows) {
    return [createHermesHydrationDiagnosticMessage({
      databasePath,
      reason: 'Hermes-Sitzung konnte nicht aus state.db gelesen werden.',
      sessionId,
    })];
  }

  return mapHermesMessages(rows);
}

/**
 * Folds Hermes' flat OpenAI-style message log into Claudian chat messages:
 * `tool` rows are merged back into the assistant turn that requested them, and
 * assistant turns that only carried tool calls merge into the next one.
 */
export function mapHermesMessages(rows: StoredRow[]): ChatMessage[] {
  const resultsByToolCallId = new Map<string, StoredRow>();
  for (const row of rows) {
    const toolCallId = getString(row.tool_call_id);
    if (getString(row.role) === 'tool' && toolCallId) {
      resultsByToolCallId.set(toolCallId, row);
    }
  }

  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const role = getString(row.role);
    const id = getRowId(row);
    if (!id || role === 'tool' || role === 'system') {
      continue;
    }

    const timestamp = getTimestampMs(row.timestamp);
    if (role === 'user') {
      const content = stripVaultPrompt(getString(row.content) ?? '');
      if (!content.trim()) {
        continue;
      }

      messages.push({
        assistantMessageId: undefined,
        content: extractUserQuery(content),
        id,
        role: 'user',
        timestamp,
        userMessageId: id,
      });
      continue;
    }

    if (role !== 'assistant') {
      continue;
    }

    const toolCalls = buildAssistantToolCalls(row, resultsByToolCallId);
    const contentBlocks = buildAssistantContentBlocks(row, toolCalls);
    const text = getString(row.content) ?? '';
    if (!text.trim() && toolCalls.length === 0 && contentBlocks.length === 0) {
      continue;
    }

    messages.push({
      assistantMessageId: id,
      content: text,
      ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
      id,
      role: 'assistant',
      timestamp,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  return mergeAdjacentAssistantMessages(messages);
}

export function isHermesSessionHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(HERMES_HYDRATION_DIAGNOSTIC_ID_PREFIX);
}

export function stripVaultPrompt(content: string): string {
  return content.replace(VAULT_PROMPT_PATTERN, '');
}

function buildAssistantContentBlocks(
  row: StoredRow,
  toolCalls: ToolCallInfo[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  const reasoning = (getString(row.reasoning_content) ?? getString(row.reasoning) ?? '').trim();
  if (reasoning) {
    blocks.push({ content: reasoning, type: 'thinking' });
  }

  const text = getString(row.content) ?? '';
  if (text.trim()) {
    blocks.push({ content: text, type: 'text' });
  }

  for (const toolCall of toolCalls) {
    blocks.push({ toolId: toolCall.id, type: 'tool_use' });
  }

  return blocks;
}

function buildAssistantToolCalls(
  row: StoredRow,
  resultsByToolCallId: Map<string, StoredRow>,
): ToolCallInfo[] {
  return parseToolCallRecords(row.tool_calls).map((record) => {
    const resultRow = resultsByToolCallId.get(record.id);
    const result = resultRow ? getString(resultRow.content) ?? undefined : undefined;
    const rawName = getString(resultRow?.tool_name) ?? record.rawName;
    const input = normalizeHermesToolInput(rawName, record.arguments);
    const name = normalizeHermesToolName(rawName);

    const toolCall: ToolCallInfo = {
      id: record.id,
      input,
      name,
      ...(result !== undefined ? { result } : {}),
      status: resolveToolStatus(resultRow, result),
    };

    if (toolCall.status === 'completed' && isWriteEditTool(name)) {
      const toolUseResult = normalizeHermesToolUseResult(rawName, input, parseJsonValue(result));
      const diffData = extractDiffData(toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
      }
    }

    return toolCall;
  });
}

/** A tool call with no stored result belongs to a turn that never finished. */
function resolveToolStatus(
  resultRow: StoredRow | undefined,
  result: string | undefined,
): ToolCallInfo['status'] {
  if (!resultRow) {
    return 'running';
  }
  return isFailedToolResult(result) ? 'error' : 'completed';
}

/**
 * Mirrors `acp_adapter/tools.py::_tool_result_failed`: only structured failure
 * signals count, so a command that merely printed the word "error" stays green.
 */
function isFailedToolResult(result: string | undefined): boolean {
  if (result?.startsWith("Error executing tool '")) {
    return true;
  }

  const parsed = parseJsonValue(result);
  if (!isPlainObject(parsed)) {
    return false;
  }

  if (parsed.success === false || parsed.ok === false) {
    return true;
  }

  const exitCode = parsed.exit_code ?? parsed.returncode;
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return true;
  }

  return Boolean(parsed.error) && !parsed.content;
}

function parseToolCallRecords(value: unknown): HermesToolCallRecord[] {
  const parsed = typeof value === 'string' ? parseJsonValue(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.flatMap((entry) => {
    if (!isPlainObject(entry)) {
      return [];
    }

    const id = getString(entry.id) ?? getString(entry.call_id);
    const fn = isPlainObject(entry.function) ? entry.function : null;
    const rawName = getString(fn?.name);
    if (!id || !rawName) {
      return [];
    }

    const parsedArguments = parseJsonValue(getString(fn?.arguments) ?? undefined);
    return [{
      arguments: isPlainObject(parsedArguments) ? parsedArguments : {},
      id,
      rawName,
    }];
  });
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (message.role === 'assistant' && previous?.role === 'assistant') {
      previous.content += message.content;
      previous.assistantMessageId = message.assistantMessageId ?? previous.assistantMessageId;
      previous.toolCalls = mergeOptionalArrays(previous.toolCalls, message.toolCalls);
      previous.contentBlocks = mergeOptionalArrays(previous.contentBlocks, message.contentBlocks);
      continue;
    }

    merged.push(message);
  }

  return merged;
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  if (!left?.length && !right?.length) {
    return undefined;
  }

  return [...(left ?? []), ...(right ?? [])];
}

function createHermesHydrationDiagnosticMessage(params: {
  databasePath?: string;
  reason: string;
  sessionId?: string;
}): ChatMessage {
  const content = [
    'Hermes-Sitzung konnte nicht geladen werden.',
    'provider: Hermes',
    ...(params.sessionId ? [`sessionId: ${params.sessionId}`] : []),
    ...(params.databasePath ? [`statePath: ${params.databasePath}`] : []),
    `reason: ${params.reason}`,
  ].join('\n');
  const safeId = (params.sessionId ?? 'session')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 120) || 'session';

  return {
    assistantMessageId: undefined,
    content,
    contentBlocks: [{ content, type: 'text' }],
    id: `${HERMES_HYDRATION_DIAGNOSTIC_ID_PREFIX}-${safeId}`,
    role: 'assistant',
    timestamp: Date.now(),
  };
}

function getRowId(row: StoredRow): string | null {
  const id = row.id;
  if (typeof id === 'number' && Number.isFinite(id)) {
    return `hermes-${id}`;
  }
  return typeof id === 'string' && id.trim() ? `hermes-${id.trim()}` : null;
}

/** Hermes stores fractional epoch seconds; Claudian expects epoch milliseconds. */
function getTimestampMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 1_000)
    : Date.now();
}

function parseJsonValue(value: string | undefined): unknown {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
