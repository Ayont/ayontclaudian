import { FreebuffSseParser } from '@/providers/freebuff/runtime/FreebuffSseParser';

const frame = (json: unknown): string => `data: ${JSON.stringify(json)}\n\n`;

describe('FreebuffSseParser', () => {
  it('parses complete data frames into bus events', () => {
    const parser = new FreebuffSseParser();
    const events = parser.push(frame({ type: 'agent', threadId: 't1', seq: 3, event: { type: 'text', text: 'hi' } }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent');
    expect(events[0].threadId).toBe('t1');
    expect(events[0].seq).toBe(3);
    expect(events[0].event?.type).toBe('text');
  });

  it('reassembles events split across chunk boundaries', () => {
    const parser = new FreebuffSseParser();
    const full = frame({ type: 'agent', threadId: 't2', seq: 9, event: { type: 'finish' } });
    const cut = Math.floor(full.length / 2);
    expect(parser.push(full.slice(0, cut))).toHaveLength(0);
    const events = parser.push(full.slice(cut));
    expect(events).toHaveLength(1);
    expect(events[0].event?.type).toBe('finish');
  });

  it('ignores comment pings and malformed payloads without dying', () => {
    const parser = new FreebuffSseParser();
    expect(parser.push(': ping\n\n')).toHaveLength(0);
    expect(parser.push('data: not-json\n\n')).toHaveLength(0);
    const events = parser.push(frame({ type: 'state' }));
    expect(events).toHaveLength(1);
  });
});