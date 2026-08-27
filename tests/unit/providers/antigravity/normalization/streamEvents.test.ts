import {
  mapAgyStreamEventToChunks,
  parseAgyStreamLine,
  usageFromAgyStream,
} from '@/providers/antigravity/normalization/streamEvents';

// Live-captured against agy 1.1.13 `--output-format stream-json`.
const INIT =
  '{"event":"init","conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","init":{"cwd":"/vault","tools":["list_dir","run_command"],"permission_mode":"always-proceed"}}';
const TEXT_DELTA =
  '{"event":"step_update","step_update":{"conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","step_index":2,"state":"ACTIVE","step_type":"agent_response","text_delta":"ok"}}';
const TEXT_DONE =
  '{"event":"step_update","step_update":{"conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"\\n","duration_seconds":2.56,"usage":{"input_tokens":27071,"output_tokens":21,"thinking_tokens":20,"cache_read_tokens":0,"total_tokens":27092}}}';
const RESULT =
  '{"event":"result","result":{"conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","status":"SUCCESS","response":"ok\\n","duration_seconds":3.83,"num_turns":1,"usage":{"input_tokens":27168,"output_tokens":24,"thinking_tokens":20,"cache_read_tokens":0,"total_tokens":27192}}}';
const TOOL_ACTIVE =
  '{"event":"step_update","step_update":{"conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/tmp"}}}}';
const TOOL_DONE =
  '{"event":"step_update","step_update":{"conversation_id":"57e03061-3145-4604-8bac-78e541f65f40","step_index":4,"state":"DONE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/tmp"},"output":"agy-probe.py\\n"}}}';

describe('parseAgyStreamLine', () => {
  it('parses the live init event and exposes the conversation id', () => {
    const event = parseAgyStreamLine(INIT);
    expect(event).toEqual(
      expect.objectContaining({
        kind: 'init',
        conversationId: '57e03061-3145-4604-8bac-78e541f65f40',
        tools: expect.arrayContaining(['list_dir', 'run_command']),
      }),
    );
  });

  it('parses live text deltas from agent_response steps', () => {
    const event = parseAgyStreamLine(TEXT_DELTA);
    expect(event).toEqual(
      expect.objectContaining({
        kind: 'step_update',
        stepType: 'agent_response',
        state: 'ACTIVE',
        textDelta: 'ok',
      }),
    );
  });

  it('parses the terminal result with real token usage', () => {
    expect(parseAgyStreamLine(RESULT)).toEqual(
      expect.objectContaining({
        kind: 'result',
        status: 'SUCCESS',
        response: 'ok\n',
        usage: {
          inputTokens: 27168,
          outputTokens: 24,
          thinkingTokens: 20,
          cacheReadTokens: 0,
          totalTokens: 27192,
        },
      }),
    );
  });

  it('returns null for blank or non-json lines', () => {
    expect(parseAgyStreamLine('')).toBeNull();
    expect(parseAgyStreamLine('not json')).toBeNull();
  });
});

describe('mapAgyStreamEventToChunks', () => {
  it('turns live tool steps into tool_use then tool_result', () => {
    const emitted = new Set<number>();
    const active = parseAgyStreamLine(TOOL_ACTIVE);
    const done = parseAgyStreamLine(TOOL_DONE);
    expect(active && mapAgyStreamEventToChunks(active, { toolUseEmitted: emitted })).toEqual([
      { type: 'tool_use', id: 'agy-stream-4', name: 'LS', input: { path: '/tmp' } },
    ]);
    expect(done && mapAgyStreamEventToChunks(done, { toolUseEmitted: emitted })).toEqual([
      { type: 'tool_result', id: 'agy-stream-4', content: 'agy-probe.py\n' },
    ]);
  });

  it('turns text deltas into text chunks and result usage into an authoritative usage chunk', () => {
    const delta = parseAgyStreamLine(TEXT_DELTA);
    const done = parseAgyStreamLine(TEXT_DONE);
    const result = parseAgyStreamLine(RESULT);
    expect(delta && mapAgyStreamEventToChunks(delta)).toEqual([{ type: 'text', content: 'ok' }]);
    expect(done && mapAgyStreamEventToChunks(done, { contextWindow: 1_000_000 })).toEqual([
      { type: 'text', content: '\n' },
    ]);
    const usageChunks = result ? mapAgyStreamEventToChunks(result, { contextWindow: 1_000_000 }) : [];
    expect(usageChunks[0]).toEqual(
      expect.objectContaining({
        type: 'usage',
        sessionId: '57e03061-3145-4604-8bac-78e541f65f40',
        usage: expect.objectContaining({ reportType: 'final' }),
      }),
    );
  });

  it('does not publish terminal usage from a failed result', () => {
    const failed = parseAgyStreamLine(RESULT.replace('"SUCCESS"', '"FAILED"'));
    expect(failed && mapAgyStreamEventToChunks(failed, { contextWindow: 1_000_000 })).toEqual([]);
  });
});

describe('usageFromAgyStream', () => {
  it('maps agy token counts onto UsageInfo without estimating', () => {
    const usage = usageFromAgyStream(
      {
        inputTokens: 27168,
        outputTokens: 24,
        thinkingTokens: 20,
        cacheReadTokens: 0,
        totalTokens: 27192,
      },
      1_000_000,
    );
    expect(usage.inputTokens).toBe(27168);
    expect(usage.outputTokens).toBe(24);
    expect(usage.cacheReadInputTokens).toBe(0);
    expect(usage.contextTokens).toBe(27192);
    expect(usage.contextWindow).toBe(1_000_000);
    expect(usage.contextWindowIsAuthoritative).toBe(false);
    expect(usage.percentage).toBe(3);
  });
});
