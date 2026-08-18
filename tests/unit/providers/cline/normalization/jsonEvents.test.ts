import {
  createClineReplayState,
  extractClineJsonText,
  parseClineJsonLine,
  shouldEmitClineText,
  shouldEmitClineThinking,
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

  it('reads Cline 3.x tool name from event.name', () => {
    const tool = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: {
        event: {
          type: 'content_start',
          contentType: 'tool',
          id: 'call_1',
          name: 'read_files',
          input: { files: [{ path: 'Home.md' }] },
        },
      },
    }));
    expect(tool).toEqual(expect.objectContaining({
      kind: 'tool_start',
      toolCallId: 'call_1',
      toolName: 'read_files',
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

  it('does not reprint content_end text when run_result repeats the same answer', () => {
    const buffer = [
      '{"type":"agent_event","payload":{"event":{"type":"content_end","contentType":"text","text":"Hi Niccolo!"}}}',
      '{"type":"run_result","text":"Hi Niccolo!","usage":{"inputTokens":10,"outputTokens":20}}',
    ].join('\n');
    expect(extractClineJsonText(buffer)).toBe('Hi Niccolo!');
  });

  it('keeps streamed deltas and drops the content_end plus run_result snapshots', () => {
    const buffer = [
      '{"type":"agent_event","payload":{"event":{"type":"content_start","contentType":"text","text":"Hi "}}}',
      '{"type":"agent_event","payload":{"event":{"type":"content_start","contentType":"text","text":"Niccolo!"}}}',
      '{"type":"agent_event","payload":{"event":{"type":"content_end","contentType":"text","text":"Hi Niccolo!"}}}',
      '{"type":"run_result","text":"Hi Niccolo!","usage":{"inputTokens":10,"outputTokens":20}}',
    ].join('\n');
    expect(extractClineJsonText(buffer)).toBe('Hi Niccolo!');
  });
});

describe('Cline content_end snapshots', () => {
  it('marks reasoning content_end as a final thinking snapshot', () => {
    const event = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: {
        event: {
          type: 'content_end',
          contentType: 'reasoning',
          reasoning: 'vault glance',
        },
      },
    }));
    expect(event).toEqual(expect.objectContaining({
      kind: 'thinking',
      text: 'vault glance',
      isFinal: true,
    }));
  });

  it('drops a late reasoning snapshot after the answer already started', () => {
    const state = createClineReplayState();
    const answer = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: { event: { type: 'content_end', contentType: 'text', text: 'Hi Niccolo!' } },
    }));
    const lateReasoning = parseClineJsonLine(JSON.stringify({
      type: 'agent_event',
      payload: { event: { type: 'content_end', contentType: 'reasoning', reasoning: 'vault glance' } },
    }));
    expect(answer && shouldEmitClineText(answer, state)).toBe(true);
    expect(lateReasoning && shouldEmitClineThinking(lateReasoning, state)).toBe(false);
  });
});
