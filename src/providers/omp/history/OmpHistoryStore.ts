import * as fs from 'node:fs/promises';

import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import {
  normalizeOmpToolInput,
  normalizeOmpToolName,
} from '../normalization/ompToolNormalization';
import { findOmpSessionFile } from '../runtime/OmpPaths';

/**
 * Oh My Pi replay reads the session transcript, not a database.
 *
 * Every session is one JSONL file under `<agentDir>/sessions/<slug>/`, written
 * one record per line. Verified record shapes (omp v18.2.3):
 *
 * - `{"type":"session","id":…,"cwd":…}`            — session header
 * - `{"type":"message","message":{role,content}}`  — role ∈ user|assistant|toolResult
 * - `{"type":"custom","customType":…}`             — tool lifecycle events
 * - `{"type":"custom_message","customType":…}`     — internal envelopes (goal context, …)
 *
 * `custom_message` records are deliberately skipped: they are Claudian- and
 * harness-injected context, not something the user typed, and replaying them as
 * user turns would put the goal preamble into the visible transcript.
 */

const OMP_HYDRATION_DIAGNOSTIC_ID_PREFIX = 'omp-hydration-error';

/** Guards against pathological transcripts blocking the UI thread. */
const MAX_TRANSCRIPT_BYTES = 12 * 1024 * 1024;

interface OmpTranscriptRecord {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  message?: unknown;
  customType?: unknown;
  data?: unknown;
}

interface OmpContentPart {
  type?: unknown;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  args?: unknown;
  result?: unknown;
  isError?: unknown;
}

export async function loadOmpSessionMessages(
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatMessage[]> {
  const filePath = findOmpSessionFile(sessionId, env);
  if (!filePath) {
    return [];
  }

  let raw: string;
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_TRANSCRIPT_BYTES) {
      return [createOmpHydrationDiagnosticMessage({
        reason: `Transkript ist zu groß (${Math.round(stat.size / 1024 / 1024)} MB).`,
        sessionId,
      })];
    }
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [createOmpHydrationDiagnosticMessage({ reason: message, sessionId })];
  }

  return mapOmpTranscript(raw, sessionId);
}

export function mapOmpTranscript(raw: string, sessionId = ''): ChatMessage[] {
  const messages: ChatMessage[] = [];
  /** Tool calls seen on the latest assistant message, awaiting their results. */
  let pendingToolCalls: ToolCallInfo[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let record: OmpTranscriptRecord;
    try {
      record = JSON.parse(line) as OmpTranscriptRecord;
    } catch {
      continue;
    }

    if (record.type !== 'message') {
      continue;
    }

    const envelope = record.message;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      continue;
    }

    const { role, content } = envelope as { role?: unknown; content?: unknown };
    const parts = Array.isArray(content) ? content as OmpContentPart[] : [];

    if (role === 'toolResult') {
      applyToolResults(pendingToolCalls, parts);
      continue;
    }

    if (role !== 'user' && role !== 'assistant') {
      continue;
    }

    const text = parts
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('')
      .trim();
    const toolCalls = parts.flatMap(toToolCallInfo);

    if (!text && toolCalls.length === 0) {
      continue;
    }

    const message: ChatMessage = {
      content: text,
      id: typeof record.id === 'string' && record.id
        ? `omp-${record.id}`
        : `omp-${role}-${messages.length}`,
      role,
      timestamp: toTimestamp(record.timestamp),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
    messages.push(message);
    pendingToolCalls = role === 'assistant' ? toolCalls : [];
  }

  if (messages.length === 0 && raw.trim()) {
    return [createOmpHydrationDiagnosticMessage({
      reason: 'Transkript enthält keine lesbaren Nachrichten.',
      sessionId,
    })];
  }

  return messages;
}

function toToolCallInfo(part: OmpContentPart): ToolCallInfo[] {
  if (part.type !== 'toolCall') {
    return [];
  }

  const rawName = typeof part.toolName === 'string' ? part.toolName : '';
  if (!rawName) {
    return [];
  }

  const rawInput = part.input ?? part.args;
  return [{
    id: typeof part.toolCallId === 'string' ? part.toolCallId : rawName,
    input: normalizeOmpToolInput(rawName, toRecord(rawInput)),
    name: normalizeOmpToolName(rawName),
    status: 'completed',
  }];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function applyToolResults(
  pendingToolCalls: ToolCallInfo[],
  parts: readonly OmpContentPart[],
): void {
  for (const part of parts) {
    const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : '';
    const target = toolCallId
      ? pendingToolCalls.find((call) => call.id === toolCallId)
      : undefined;
    if (!target) {
      continue;
    }

    target.result = toResultText(part.result);
    if (part.isError === true) {
      target.status = 'error';
    }
  }
}

function toResultText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function createOmpHydrationDiagnosticMessage(context: {
  reason: string;
  sessionId: string;
}): ChatMessage {
  return {
    content: `OMP-Verlauf konnte nicht geladen werden: ${context.reason}`,
    id: `${OMP_HYDRATION_DIAGNOSTIC_ID_PREFIX}-session-${context.sessionId}`,
    role: 'assistant',
    timestamp: Date.now(),
  };
}

export function isOmpSessionHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(`${OMP_HYDRATION_DIAGNOSTIC_ID_PREFIX}-session-`);
}
