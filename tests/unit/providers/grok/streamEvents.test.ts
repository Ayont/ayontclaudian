import { parseGrokStream, parseGrokStreamLine } from '@/providers/grok/normalization/streamEvents';
import {
  createGrokStreamState,
  extractSessionId,
  mapGrokEventToChunks,
} from '@/providers/grok/normalization/streamMapping';

describe('parseGrokStreamLine (grok --output-format streaming-json)', () => {
  it('parses a text delta', () => {
    expect(parseGrokStreamLine('{"type":"text","data":"Hello"}')).toEqual({
      type: 'text',
      data: 'Hello',
      sessionId: undefined,
      stopReason: undefined,
      raw: { type: 'text', data: 'Hello' },
    });
  });

  it('parses a thought delta', () => {
    expect(parseGrokStreamLine('{"type":"thought","data":"hmm"}')?.type).toBe('thought');
  });

  it('parses the terminal end event with sessionId + stopReason', () => {
    const event = parseGrokStreamLine('{"type":"end","stopReason":"EndTurn","sessionId":"abc123"}');
    expect(event?.type).toBe('end');
    expect(event?.sessionId).toBe('abc123');
    expect(event?.stopReason).toBe('EndTurn');
  });

  it('returns null for blank / invalid / typeless lines', () => {
    expect(parseGrokStreamLine('')).toBeNull();
    expect(parseGrokStreamLine('not json')).toBeNull();
    expect(parseGrokStreamLine('{"data":"no type"}')).toBeNull();
  });
});

describe('mapGrokEventToChunks', () => {
  it('maps text → text chunk, thought → thinking chunk, end → captures session', () => {
    const state = createGrokStreamState();
    expect(mapGrokEventToChunks({ type: 'text', data: 'Hi', raw: {} }, state)).toEqual([
      { type: 'text', content: 'Hi' },
    ]);
    expect(mapGrokEventToChunks({ type: 'thought', data: 'reasoning', raw: {} }, state)).toEqual([
      { type: 'thinking', content: 'reasoning' },
    ]);
    expect(mapGrokEventToChunks({ type: 'end', sessionId: 's1', stopReason: 'EndTurn', raw: {} }, state)).toEqual([]);
    expect(state.sessionId).toBe('s1');
  });
});

describe('extractSessionId', () => {
  it('finds the sessionId from the end event of a buffer', () => {
    const buffer = [
      '{"type":"text","data":"a"}',
      '{"type":"end","sessionId":"sess-9","stopReason":"EndTurn"}',
    ].join('\n');
    expect(extractSessionId(parseGrokStream(buffer))).toBe('sess-9');
  });
});
