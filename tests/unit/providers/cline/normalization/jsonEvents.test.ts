import {
  extractClineJsonText,
  parseClineJsonLine,
} from '@/providers/cline/normalization/jsonEvents';

describe('parseClineJsonLine', () => {
  it('treats assistant.delta content_start text as a live delta', () => {
    const event = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: {
        sessionId: '1786522352621_1rqet',
        event: { type: 'content_start', contentType: 'text', text: 'Hello' },
      },
    }));
    expect(event).toEqual(expect.objectContaining({
      kind: 'text',
      text: 'Hello',
      sessionId: '1786522352621_1rqet',
    }));
  });

  it('maps reasoning deltas and tool start/end', () => {
    const think = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: {
        sessionId: '1786522352621_1rqet',
        event: { type: 'content_start', contentType: 'reasoning', reasoning: 'hmm' },
      },
    }));
    expect(think?.kind).toBe('thinking');
    expect(think?.text).toBe('hmm');

    const tool = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: {
        event: {
          type: 'content_start',
          contentType: 'tool',
          toolCallId: 't1',
          toolName: 'Read',
          input: { path: 'a.ts' },
        },
      },
    }));
    expect(tool).toEqual(expect.objectContaining({
      kind: 'tool_start',
      toolCallId: 't1',
      toolName: 'Read',
    }));
  });

  it('accepts the documented flat {event.text} shape', () => {
    const event = parseClineJsonLine('{"type":"agent_event","event":{"text":"OK"}}');
    expect(event).toEqual(expect.objectContaining({ kind: 'text', text: 'OK' }));
  });
});

describe('extractClineJsonText', () => {
  it('joins documented agent_event text lines', () => {
    const buffer = [
      '{"type":"agent_event","event":{"text":"Hello "}}',
      '{"type":"agent_event","payload":{"event":{"type":"content_start","contentType":"text","text":"world"}}}',
      'not-json',
    ].join('\n');
    expect(extractClineJsonText(buffer)).toBe('Hello world');
  });
});
