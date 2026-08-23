import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import {
  createDshTailState,
  decompressZstdFrames,
  tailDshSession,
} from '@/providers/dsh/runtime/dshSessionTail';

const TEXT_DELTA = JSON.stringify({
  type: 'assistant/chunk', seq: 19,
  data: { chunk: { type: 'text-delta', text: 'Hallo' } },
});
const MORE_TEXT = JSON.stringify({
  type: 'assistant/chunk', seq: 20,
  data: { chunk: { type: 'text-delta', text: ' Welt' } },
});

/** dsh appends one INDEPENDENT zstd frame per record batch. */
function frame(...lines: string[]): Buffer {
  return zstdCompressSync(Buffer.from(`${lines.join('\n')}\n`, 'utf8'));
}

describe('decompressZstdFrames', () => {
  it('spans concatenated frames, which a single decompress call cannot', () => {
    const buffer = Buffer.concat([frame(TEXT_DELTA), frame(MORE_TEXT)]);

    const { bytesConsumed, text } = decompressZstdFrames(buffer);

    expect(text.split('\n').filter(Boolean)).toEqual([TEXT_DELTA, MORE_TEXT]);
    expect(bytesConsumed).toBe(buffer.length);
  });

  // dsh is still writing the tail while the plugin reads it.
  it('leaves a half-written trailing frame unconsumed so the next tick retries', () => {
    const complete = frame(TEXT_DELTA);
    const partial = frame(MORE_TEXT);
    const buffer = Buffer.concat([complete, partial.subarray(0, partial.length - 6)]);

    const { bytesConsumed, text } = decompressZstdFrames(buffer);

    expect(text.split('\n').filter(Boolean)).toEqual([TEXT_DELTA]);
    expect(bytesConsumed).toBe(complete.length);
  });

  it('returns nothing for a buffer with no frame at all', () => {
    expect(decompressZstdFrames(Buffer.from('not zstd'))).toEqual({ bytesConsumed: 0, text: '' });
  });
});

describe('tailDshSession', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tail-'));
    file = path.join(dir, 'session.jsonl.zstd');
  });

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true });
  });

  it('projects appended records and remembers the byte offset', async () => {
    fs.writeFileSync(file, frame(TEXT_DELTA));

    const first = await tailDshSession(file, createDshTailState());

    expect(first.chunks).toEqual([{ type: 'text', content: 'Hallo' }]);
    expect(first.state.lastSeq).toBe(19);
    expect(first.state.offset).toBeGreaterThan(0);
  });

  // The whole point of the offset: a tick must not re-read what it already had.
  it('reads only what was appended since the last tick', async () => {
    fs.writeFileSync(file, frame(TEXT_DELTA));
    const first = await tailDshSession(file, createDshTailState());

    fs.appendFileSync(file, frame(MORE_TEXT));
    const second = await tailDshSession(file, first.state);

    expect(second.chunks).toEqual([{ type: 'text', content: ' Welt' }]);
    expect(second.state.lastSeq).toBe(20);
  });

  it('yields nothing when the transcript did not grow', async () => {
    fs.writeFileSync(file, frame(TEXT_DELTA));
    const first = await tailDshSession(file, createDshTailState());

    const second = await tailDshSession(file, first.state);

    expect(second.chunks).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  it('restarts from the beginning when a fresh session reuses the path', async () => {
    fs.writeFileSync(file, Buffer.concat([frame(TEXT_DELTA), frame(MORE_TEXT)]));
    const first = await tailDshSession(file, createDshTailState());
    expect(first.state.lastSeq).toBe(20);

    fs.writeFileSync(file, frame(TEXT_DELTA));
    const second = await tailDshSession(file, { ...first.state, lastSeq: 0 });

    expect(second.chunks).toEqual([{ type: 'text', content: 'Hallo' }]);
  });

  // No external `zstd` binary is involved, so a machine without it still gets
  // the live view; a missing file must stay silent rather than throw.
  it('stays silent for a missing transcript', async () => {
    const state = createDshTailState();

    await expect(tailDshSession(path.join(dir, 'nope.zstd'), state))
      .resolves.toEqual({ chunks: [], metadata: {}, state });
  });
});
