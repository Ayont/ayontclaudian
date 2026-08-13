/**
 * Extracts assistant text from `cline --json` NDJSON.
 *
 * Documented shape (`cline --help` / npm README):
 *   { "type": "agent_event", "event": { "text": "..." } }
 *
 * Also accepts a few sibling shapes seen in session dumps.
 */
export function extractClineJsonText(buffer: string): string {
  const parts: string[] = [];
  for (const line of buffer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const text = readEventText(parsed);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join('');
}

function readEventText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const event = isPlainObject(record.event) ? record.event : record;
  if (typeof event.text === 'string' && event.text) {
    return event.text;
  }
  if (typeof event.content === 'string' && event.content) {
    return event.content;
  }
  if (Array.isArray(event.content)) {
    const joined = event.content
      .map((block) => (isPlainObject(block) && typeof block.text === 'string' ? block.text : ''))
      .join('');
    return joined || null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
