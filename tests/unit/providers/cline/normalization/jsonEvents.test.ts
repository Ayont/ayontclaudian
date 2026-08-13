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

  it('maps CLI run_result usage and finish errors', () => {
    const result = parseClineJsonLine(JSON.stringify({
      type: 'run_result',
      finishReason: 'completed',
      text: 'Hallo',
      usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 10 },
    }));
    expect(result).toEqual(expect.objectContaining({
      kind: 'usage',
      text: 'Hallo',
      isFinal: true,
      usage: expect.objectContaining({ inputTokens: 120, outputTokens: 40 }),
    }));

    const failed = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      event: { type: 'error', message: 'invalid model format' },
    }));
    expect(failed).toEqual(expect.objectContaining({
      kind: 'error',
      text: 'invalid model format',
    }));
  });

  it('maps CLI run_start and run_result envelopes from 3.0.54', () => {
    const start = parseClineJsonLine(JSON.stringify({
      type: 'run_start',
      providerId: 'cline-pass',
      modelId: 'cline-pass/kimi-k3',
      sessionId: '1786522352621_1rqet',
    }));
    expect(start).toEqual(expect.objectContaining({
      kind: 'session',
      sessionId: '1786522352621_1rqet',
    }));

    const result = parseClineJsonLine(JSON.stringify({
      type: 'run_result',
      finishReason: 'completed',
      text: 'Hallo',
    }));
    expect(result).toEqual(expect.objectContaining({
      kind: 'text',
      text: 'Hallo',
      isFinal: true,
    }));
  });

  it('maps assistant-text-delta events from the live AgentEvent dump', () => {
    const event = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      event: { type: 'assistant-text-delta', text: 'Hey' },
    }));
    expect(event).toEqual(expect.objectContaining({ kind: 'text', text: 'Hey' }));
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

  it('uses run_result text when no deltas arrived', () => {
    expect(extractClineJsonText('{"type":"run_result","text":"Fertig"}')).toBe('Fertig');
  });
});
