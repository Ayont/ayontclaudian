/**
 * Parsing for Grok CLI's `--output-format streaming-json` output.
 *
 * Verified `grok` v0.2 schema (from the shipped CLI docs): newline-delimited
 * JSON DELTA events with a top-level `type` discriminator (unlike Kimi/Vibe's
 * one-complete-message-per-line). Observed event shapes:
 *   {"type":"text","data":"…"}      — visible assistant text delta
 *   {"type":"thought","data":"…"}   — reasoning delta
 *   {"type":"end","stopReason":"EndTurn","sessionId":"…","requestId":"…"}
 *
 * Tool calls run with `--always-approve` and are not surfaced as stream events
 * in this format, so only text/thought/end are modelled. The terminal `end`
 * event carries the `sessionId` used to resume the conversation (`-r <id>`).
 */

export type GrokEventType = 'text' | 'thought' | 'end' | (string & {});

/** A normalized Grok streaming-json line. */
export interface GrokStreamEvent {
  type: GrokEventType;
  /** Text/thought payload (`data` field) when present. */
  data?: string;
  /** Resume id from the terminal `end` event. */
  sessionId?: string;
  /** Stop reason from the terminal `end` event (e.g. "EndTurn"). */
  stopReason?: string;
  /** Original parsed object for fields not modelled here. */
  raw: Record<string, unknown>;
}

function toStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parse a single streaming-json NDJSON line. Returns `null` for blank/invalid lines. */
export function parseGrokStreamLine(line: string): GrokStreamEvent | null {
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
    type: type as GrokEventType,
    data: toStr(record.data),
    sessionId: toStr(record.sessionId),
    stopReason: toStr(record.stopReason),
    raw: record,
  };
}

/** Parse a full streaming-json buffer into events (in stream order). */
export function parseGrokStream(buffer: string): GrokStreamEvent[] {
  const events: GrokStreamEvent[] = [];
  for (const line of buffer.split('\n')) {
    const event = parseGrokStreamLine(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
}
