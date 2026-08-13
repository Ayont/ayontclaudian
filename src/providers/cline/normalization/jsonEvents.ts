export type ClineJsonKind =
  | 'text'
  | 'thinking'
  | 'tool_start'
  | 'tool_end'
  | 'session'
  | 'other';

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
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
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

  const inner = readInnerEvent(parsed);
  const sessionId = readSessionId(parsed, inner);
  const contentType = asString(inner.contentType);
  const eventType = asString(inner.type);

  if (contentType === 'reasoning' || eventType === 'reasoning.delta') {
    return {
      kind: 'thinking',
      sessionId,
      text: asString(inner.reasoning) ?? asString(inner.text),
    };
  }

  if (contentType === 'tool') {
    const toolInput = isPlainObject(inner.input) ? inner.input : undefined;
    if (eventType === 'content_end') {
      return {
        kind: 'tool_end',
        sessionId,
        toolCallId: asString(inner.toolCallId),
        toolName: asString(inner.toolName),
        toolOutput: asString(inner.output),
        toolError: asString(inner.error),
      };
    }
    return {
      kind: 'tool_start',
      sessionId,
      toolCallId: asString(inner.toolCallId),
      toolName: asString(inner.toolName),
      toolInput,
    };
  }

  const text = asString(inner.text) ?? asString(inner.content);
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
    if (event?.kind !== 'text' || !event.text) {
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
