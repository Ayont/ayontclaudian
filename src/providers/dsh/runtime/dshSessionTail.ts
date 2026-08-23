import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** One live delta projected out of the compressed session transcript. */
export interface DshLiveEvent {
  seq: number;
  kind: 'text' | 'thinking';
  text: string;
}

/** Extracts streamable deltas from one JSONL line of the session transcript.
 *  The headless runner writes assistant/chunk records live; everything else
 *  (block framing, usage, titles) is structural and stays ignored. */
export function parseDshSessionLine(line: string): DshLiveEvent[] {
  if (!line.includes('assistant/chunk')) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  const record = parsed as { seq?: number; data?: { chunk?: { type?: string; text?: string } } };
  const chunk = record.data?.chunk;
  const kind = chunk?.type === 'text-delta' ? 'text' : chunk?.type === 'reasoning-delta' ? 'thinking' : null;
  if (!kind || typeof chunk?.text !== 'string' || typeof record.seq !== 'number') {
    return [];
  }
  return [{ seq: record.seq, kind, text: chunk.text }];
}

/** Splits decompressed transcript text into events past the watermark.
 *  The returned watermark only moves forward, so repeated tails are safe. */
export function extractNewDshEvents(
  jsonl: string,
  lastSeq: number,
): { events: DshLiveEvent[]; lastSeq: number } {
  const events: DshLiveEvent[] = [];
  let watermark = lastSeq;
  for (const line of jsonl.split('\n')) {
    for (const event of parseDshSessionLine(line)) {
      if (event.seq > watermark) {
        watermark = event.seq;
        events.push(event);
      }
    }
  }
  return { events, lastSeq: watermark };
}

/** Decompresses the zstd session transcript and returns the new events.
 *  Whole-file decompress per tick is fine: transcripts stay small, and a
 *  sequence watermark keeps projection idempotent. */
export async function tailDshSessionFile(
  file: string,
  lastSeq: number,
): Promise<{ events: DshLiveEvent[]; lastSeq: number }> {
  try {
    const { stdout } = await execFileAsync('zstd', ['-dc', file], { maxBuffer: 64 * 1024 * 1024 });
    return extractNewDshEvents(stdout, lastSeq);
  } catch {
    // Missing file or missing zstd binary: no live view this tick.
    return { events: [], lastSeq };
  }
}