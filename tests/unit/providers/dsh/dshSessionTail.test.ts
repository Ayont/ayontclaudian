import {
  extractNewDshEvents,
  parseDshSessionLine,
} from '@/providers/dsh/runtime/dshSessionTail';

const TEXT_LINE = JSON.stringify({
  type: 'assistant/chunk', seq: 19, time: 1,
  data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hallo Welt' } },
});
const THINKING_LINE = JSON.stringify({
  type: 'assistant/chunk', seq: 20, time: 2,
  data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'denke nach' } },
});

describe('parseDshSessionLine', () => {
  it('maps text and reasoning deltas to stream kinds', () => {
    expect(parseDshSessionLine(TEXT_LINE)).toEqual([{ seq: 19, kind: 'text', text: 'Hallo Welt' }]);
    expect(parseDshSessionLine(THINKING_LINE)).toEqual([{ seq: 20, kind: 'thinking', text: 'denke nach' }]);
  });

  it('ignores structural chunks and broken lines', () => {
    const blockStart = JSON.stringify({ type: 'assistant/chunk', seq: 5, data: { chunk: { type: 'block-start', index: 0 } } });
    expect(parseDshSessionLine(blockStart)).toEqual([]);
    expect(parseDshSessionLine('garbage')).toEqual([]);
    expect(parseDshSessionLine('')).toEqual([]);
  });
});

describe('extractNewDshEvents', () => {
  it('returns only events past the watermark and the new watermark', () => {
    const jsonl = ['', TEXT_LINE, THINKING_LINE].join('\n');
    const result = extractNewDshEvents(jsonl, 18);
    expect(result.events.map((e) => e.seq)).toEqual([19, 20]);
    expect(result.lastSeq).toBe(20);
  });

  it('yields nothing when everything is already seen', () => {
    const result = extractNewDshEvents(TEXT_LINE, 19);
    expect(result.events).toHaveLength(0);
    expect(result.lastSeq).toBe(19);
  });
});