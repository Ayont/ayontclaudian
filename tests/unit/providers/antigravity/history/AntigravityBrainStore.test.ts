import { splitTranscriptLines } from '@/providers/antigravity/history/AntigravityBrainStore';

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
