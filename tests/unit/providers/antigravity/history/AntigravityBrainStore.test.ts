import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  getAntigravityTranscriptPath,
  readAntigravityTranscriptIfChanged,
  splitTranscriptLines,
} from '@/providers/antigravity/history/AntigravityBrainStore';

// `import * as fs` yields a getter-bound module namespace under ts-jest that
// jest.spyOn cannot redefine; spy on the underlying builtin exports object
// (the same singleton the code under test resolves).
const realFs = jest.requireActual<typeof fs>('node:fs');

describe('splitTranscriptLines', () => {
  it('drops the trailing newline agy writes (no inflated line count)', () => {
    expect(splitTranscriptLines('A\nB\n')).toEqual(['A', 'B']);
    expect(splitTranscriptLines('A\nB\nC\n')).toEqual(['A', 'B', 'C']);
  });

  it('keeps cursor math consistent across an append — the dropped-event regression', () => {
    // Before the fix, split('\n') gave a phantom trailing '' so the cursor
    // over-advanced and the first newly-appended event was silently skipped.
    const prior = 'e1\ne2\n';
    const after = 'e1\ne2\ne3\n';
    const cursor = splitTranscriptLines(prior).length; // 2 (not 3)
    const lines = splitTranscriptLines(after); // ['e1','e2','e3']
    expect(lines.slice(cursor)).toEqual(['e3']); // e3 emitted, not dropped
  });

  it('keeps an incomplete (not-yet-terminated) last line', () => {
    expect(splitTranscriptLines('A\nB')).toEqual(['A', 'B']);
  });

  it('returns [] for empty or blank-only buffers', () => {
    expect(splitTranscriptLines('')).toEqual([]);
    expect(splitTranscriptLines('\n')).toEqual([]);
    expect(splitTranscriptLines('\n\n')).toEqual([]);
  });
});

describe('readAntigravityTranscriptIfChanged', () => {
  // A real temp brain dir (via GEMINI_HOME) so statSync observes true
  // size/mtime; the readFileSync spy only counts calls and still calls through.
  const conversationId = 'conv-poll-guard';
  let geminiHome = '';
  let originalGeminiHome: string | undefined;

  const transcriptPath = (): string => getAntigravityTranscriptPath(conversationId);

  const writeTranscript = (content: string): void => {
    fs.mkdirSync(path.dirname(transcriptPath()), { recursive: true });
    fs.writeFileSync(transcriptPath(), content, 'utf-8');
  };

  beforeEach(() => {
    originalGeminiHome = process.env.GEMINI_HOME;
    geminiHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-agy-store-'));
    process.env.GEMINI_HOME = geminiHome;
  });

  afterEach(() => {
    if (originalGeminiHome === undefined) {
      delete process.env.GEMINI_HOME;
    } else {
      process.env.GEMINI_HOME = originalGeminiHome;
    }
    fs.rmSync(geminiHome, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('skips the read entirely when the file is unchanged between polls', () => {
    writeTranscript('e1\ne2\n');
    const readSpy = jest.spyOn(realFs, 'readFileSync');

    const first = readAntigravityTranscriptIfChanged(conversationId, null);
    expect(first?.buffer).toBe('e1\ne2\n');
    expect(first?.stat).not.toBeNull();
    expect(readSpy).toHaveBeenCalledTimes(1);

    const second = readAntigravityTranscriptIfChanged(conversationId, first?.stat ?? null);
    expect(second).toBeNull();
    expect(readSpy).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the file grew since the last poll', () => {
    writeTranscript('e1\n');
    const readSpy = jest.spyOn(realFs, 'readFileSync');
    const first = readAntigravityTranscriptIfChanged(conversationId, null);

    writeTranscript('e1\ne2\n'); // agy appended an event
    const second = readAntigravityTranscriptIfChanged(conversationId, first?.stat ?? null);

    expect(second?.buffer).toBe('e1\ne2\n');
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('re-reads when the file shrank (truncation must reset the tail)', () => {
    writeTranscript('e1\ne2\ne3\n');
    const readSpy = jest.spyOn(realFs, 'readFileSync');
    const first = readAntigravityTranscriptIfChanged(conversationId, null);

    writeTranscript('x\n'); // truncated/rotated: same path, smaller size
    const second = readAntigravityTranscriptIfChanged(conversationId, first?.stat ?? null);

    expect(second?.buffer).toBe('x\n');
    expect(readSpy).toHaveBeenCalledTimes(2);
  });

  it('re-reads a same-size rewrite once the mtime moved', () => {
    writeTranscript('e1\n');
    const first = readAntigravityTranscriptIfChanged(conversationId, null);

    writeTranscript('e2\n'); // identical size — only the mtime can tell it apart
    fs.utimesSync(transcriptPath(), new Date(), new Date(Date.now() + 5000));
    const second = readAntigravityTranscriptIfChanged(conversationId, first?.stat ?? null);

    expect(second?.buffer).toBe('e2\n');
  });

  it('never trusts a stat cached for a different transcript path', () => {
    writeTranscript('e1\n');
    const real = fs.statSync(transcriptPath());
    const foreign = { path: '/other/transcript.jsonl', size: real.size, mtimeMs: real.mtimeMs };

    const result = readAntigravityTranscriptIfChanged(conversationId, foreign);
    expect(result?.buffer).toBe('e1\n');
  });

  it('reports a missing transcript without caching, then picks it up once created', () => {
    const missing = readAntigravityTranscriptIfChanged(conversationId, null);
    expect(missing).toEqual({ buffer: null, stat: null });

    writeTranscript('e1\n');
    const created = readAntigravityTranscriptIfChanged(conversationId, missing?.stat ?? null);
    expect(created?.buffer).toBe('e1\n');
  });
});
