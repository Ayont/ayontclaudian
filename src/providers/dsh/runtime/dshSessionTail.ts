/**
 * Incremental reader for the DeepSeek Harness session transcript.
 *
 * `session.jsonl.zstd` is not one zstd stream — it is a CONCATENATION of tens
 * of thousands of independent frames, one per appended record batch (35,787
 * frames in a real 8.9 MB transcript). That shape drives every decision here:
 *
 * - Node's `zstdDecompressSync` AND `createZstdDecompress` both stop after the
 *   first frame, so frames are located by their magic number and decompressed
 *   individually. Decompressing in-process removes the previous dependency on
 *   an external `zstd` binary, which silently produced NO live view at all on
 *   machines without it.
 * - Only the bytes appended since the last read are decompressed. Re-reading
 *   the whole file per tick cost ~500 ms; the incremental read is ~25 ms.
 * - The final frame is often half-written while dsh is appending. It simply
 *   fails to decompress and the byte offset stays before it, so the next tick
 *   picks it up complete.
 */

import { open, stat } from 'node:fs/promises';
import { zstdDecompressSync } from 'node:zlib';

import type { StreamChunk } from '../../../core/types';
import { type DshTurnMetadata, projectDshTranscript } from './dshSessionEvents';

/** Zstd frame magic (RFC 8878 §3.1.1). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/**
 * Cap on bytes decompressed per tick. A burst larger than this is read across
 * consecutive ticks instead of stalling the renderer on one huge slice.
 */
const MAX_TAIL_BYTES = 4 * 1024 * 1024;

/** Position in the transcript plus the highest record already projected. */
export interface DshTailState {
  /** Byte offset fully consumed; a partial trailing frame stays unconsumed. */
  offset: number;
  lastSeq: number;
}

export interface DshTailResult {
  chunks: StreamChunk[];
  metadata: DshTurnMetadata;
  state: DshTailState;
}

export function createDshTailState(): DshTailState {
  return { lastSeq: 0, offset: 0 };
}

/**
 * Decompresses every complete zstd frame in `buffer`.
 *
 * `bytesConsumed` counts only frames that decompressed cleanly, so a caller
 * can advance its offset without losing a partially written trailing frame.
 * A magic sequence can also occur by chance inside compressed data; when a
 * slice fails, the next boundary is folded into it and the frame retried
 * rather than dropped.
 */
export function decompressZstdFrames(
  buffer: Buffer,
): { bytesConsumed: number; text: string } {
  const boundaries: number[] = [];
  for (let at = buffer.indexOf(ZSTD_MAGIC); at >= 0; at = buffer.indexOf(ZSTD_MAGIC, at + 4)) {
    boundaries.push(at);
  }
  if (boundaries.length === 0) {
    return { bytesConsumed: 0, text: '' };
  }

  const parts: Buffer[] = [];
  let bytesConsumed = 0;
  let index = 0;

  while (index < boundaries.length) {
    let next = index + 1;
    let decoded: Buffer | null = null;
    let end = buffer.length;

    while (next <= boundaries.length) {
      end = next < boundaries.length ? boundaries[next] : buffer.length;
      try {
        const candidate = zstdDecompressSync(buffer.subarray(boundaries[index], end));
        // A truncated frame does NOT throw — it decodes to an empty (or
        // newline-less) buffer. Consuming those bytes would silently drop the
        // records dsh is still writing, so both cases count as incomplete.
        if (candidate.length > 0 && candidate[candidate.length - 1] === 0x0a) {
          decoded = candidate;
          break;
        }
        next += 1;
      } catch {
        // Either a false-positive magic inside this frame, or the frame is
        // still being written; try folding in the following boundary.
        next += 1;
      }
    }

    if (!decoded) {
      break;
    }

    parts.push(decoded);
    bytesConsumed = end;
    index = next;
  }

  return { bytesConsumed, text: Buffer.concat(parts).toString('utf8') };
}

/**
 * Reads what dsh appended since `state.offset` and projects it into stream
 * chunks. Never throws: a missing or unreadable transcript just means no live
 * view this tick.
 */
export async function tailDshSession(
  file: string,
  state: DshTailState,
): Promise<DshTailResult> {
  const empty: DshTailResult = { chunks: [], metadata: {}, state };

  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return empty;
  }

  // A shrunk file means a fresh session reused the path — restart from 0.
  const start = size < state.offset ? 0 : state.offset;
  if (size <= start) {
    return { ...empty, state: { ...state, offset: start } };
  }

  const length = Math.min(size - start, MAX_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  let handle;
  try {
    handle = await open(file, 'r');
    await handle.read(buffer, 0, length, start);
  } catch {
    return empty;
  } finally {
    await handle?.close().catch(() => {});
  }

  const { bytesConsumed, text } = decompressZstdFrames(buffer);
  if (bytesConsumed === 0) {
    return { ...empty, state: { ...state, offset: start } };
  }

  const projection = projectDshTranscript(text, state.lastSeq);
  return {
    chunks: projection.chunks,
    metadata: projection.metadata,
    state: { lastSeq: projection.lastSeq, offset: start + bytesConsumed },
  };
}
