export type ClineJsonKind =
  | 'text'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'session'
  | 'usage'
  | 'error'
  | 'other';

export interface ClineRunUsage {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ClineJsonEvent {
  kind: ClineJsonKind;
  isFinal?: boolean;
  sessionId?: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolError?: string;
  usage?: ClineRunUsage;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readUsage(value: unknown): ClineRunUsage | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const inputTokens = asFiniteNumber(value.inputTokens) ?? 0;
  const outputTokens = asFiniteNumber(value.outputTokens) ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: asFiniteNumber(value.cacheReadTokens),
    cacheWriteTokens: asFiniteNumber(value.cacheWriteTokens) ?? asFiniteNumber(value.cacheCreationTokens),
  };
}

function readInnerEvent(record: Record<string, unknown>): Record<string, unknown> {
  if (isPlainObject(record.payload) && isPlainObject(record.payload.event)) {
    return record.payload.event;
  }
  if (isPlainObject(record.event)) {
    return record.event;
  }
  return record;
}

function readSessionId(record: Record<string, unknown>, inner: Record<string, unknown>): string | undefined {
  if (isPlainObject(record.payload)) {
    const fromPayload = asString(record.payload.sessionId);
    if (fromPayload) {
      return fromPayload;
    }
  }
  return asString(record.sessionId) ?? asString(inner.sessionId);
}

/**
 * Parses one `cline --json` NDJSON line.
 *
 * Live shapes from `@cline/core`:
 *   { type: "agent_event", payload: { sessionId, event: { type, contentType, text? } } }
 *
 * Documented npm README shape:
 *   { type: "agent_event", event: { text } }
 */
export function parseClineJsonLine(line: string): ClineJsonEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) {
    return null;
  }

  const envelopeType = asString(parsed.type);
  const inner = readInnerEvent(parsed);
  const sessionId = readSessionId(parsed, inner);
  const contentType = asString(inner.contentType);
  const eventType = asString(inner.type);

  if (envelopeType === 'run_start') {
    return { kind: 'session', sessionId };
  }
  if (envelopeType === 'run_result') {
    const text = asString(parsed.text) ?? asString(inner.text);
    const usage = readUsage(parsed.usage);
    if (usage) {
      return {
        kind: 'usage',
        sessionId,
        text,
        isFinal: true,
        usage,
      };
    }
    return {
      kind: 'text',
      sessionId,
      text,
      isFinal: true,
    };
  }
  if (envelopeType === 'run_aborted' || envelopeType === 'run_abort_requested') {
    return {
      kind: 'error',
      sessionId,
      text: asString(parsed.message) ?? asString(parsed.reason) ?? 'Lauf abgebrochen',
    };
  }

  if (
    eventType === 'error'
    || eventType === 'run-failed'
    || eventType === 'run_failed'
  ) {
    return {
      kind: 'error',
      sessionId,
      text: asString(inner.message) ?? asString(inner.error) ?? asString(inner.text) ?? 'Cline-Fehler',
    };
  }

  if (
    contentType === 'reasoning'
    || eventType === 'reasoning.delta'
    || eventType === 'reasoning-delta'
    || eventType === 'assistant-reasoning-delta'
  ) {
    return {
      kind: 'thinking',
      sessionId,
      text: asString(inner.reasoning) ?? asString(inner.text),
    };
  }

  if (
    contentType === 'tool'
    || eventType === 'tool_start'
    || eventType === 'tool_call'
    || eventType === 'tool-start'
    || eventType === 'tool-call'
    || eventType === 'tool_end'
    || eventType === 'tool_result'
    || eventType === 'tool-end'
    || eventType === 'tool-result'
  ) {
    const toolInput = isPlainObject(inner.input) ? inner.input : undefined;
    if (
      eventType === 'content_end'
      || eventType === 'tool_end'
      || eventType === 'tool_result'
      || eventType === 'tool-end'
      || eventType === 'tool-result'
    ) {
      return {
        kind: 'tool_end',
        sessionId,
        toolCallId: asString(inner.toolCallId) ?? asString(inner.id),
        toolName: asString(inner.toolName) ?? asString(inner.name),
        toolOutput: asString(inner.output),
        toolError: asString(inner.error),
      };
    }
    return {
      kind: 'tool_start',
      sessionId,
      toolCallId: asString(inner.toolCallId) ?? asString(inner.id),
      toolName: asString(inner.toolName) ?? asString(inner.name),
      toolInput,
    };
  }

  const text = asString(inner.text) ?? asString(inner.content) ?? asString(inner.delta);
  if (text) {
    return {
      kind: 'text',
      sessionId,
      text,
      isFinal: eventType === 'content_end',
    };
  }

  if (sessionId) {
    return { kind: 'session', sessionId };
  }
  return { kind: 'other' };
}

/** Concatenate visible text from a full `--json` buffer (aux queries). */
export function extractClineJsonText(buffer: string): string {
  const parts: string[] = [];
  let sawDelta = false;
  for (const line of buffer.split(/\r?\n/)) {
    const event = parseClineJsonLine(line);
    if (!event || (event.kind !== 'text' && event.kind !== 'usage') || !event.text) {
      continue;
    }
    if (event.isFinal && sawDelta) {
      continue;
    }
    if (!event.isFinal) {
      sawDelta = true;
    }
    parts.push(event.text);
  }
  return parts.join('');
}
