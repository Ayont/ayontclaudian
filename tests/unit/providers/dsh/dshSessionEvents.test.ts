import {
  buildDshUsageInfo,
  mapDshDispatchToolName,
  projectDshRecord,
  projectDshTranscript,
} from '@/providers/dsh/runtime/dshSessionEvents';

// Every fixture below is a verbatim record shape captured from a real
// `dsh --profile headless` transcript (dsh 0.1.1-rc.2).
const TEXT_DELTA = JSON.stringify({
  type: 'assistant/chunk', seq: 19, time: 1,
  data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'Hallo Welt' } },
});
const REASONING_DELTA = JSON.stringify({
  type: 'assistant/chunk', seq: 20, time: 2,
  data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'denke nach' } },
});
const USAGE = JSON.stringify({
  type: 'assistant/chunk', seq: 76, time: 3,
  data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 15776, outputTokens: 174 } } },
});
const DISPATCH_START = JSON.stringify({
  type: 'tool/code-dispatch-start', seq: 455, time: 4,
  data: {
    rootCallId: 'ca97', parentCallId: 'ca97', subCallId: 'ca97:code:1',
    name: 'bash',
    arguments: { command: 'ls -la', description: 'List repo root', workdir: '/vault' },
  },
});
const DISPATCH_RESULT = JSON.stringify({
  type: 'tool/code-dispatch', seq: 457, time: 5,
  data: {
    rootCallId: 'ca97', parentCallId: 'ca97', subCallId: 'ca97:code:1',
    name: 'bash', arguments: { command: 'ls -la' },
    isError: false,
    content: [{ type: 'text', text: 'total 8080' }],
  },
});
const OUTER_TOOL_CALL = JSON.stringify({
  type: 'tool/call', seq: 454, time: 6,
  data: { turn: 2, step: 1, callId: 'ca97', name: 'run_code', arguments: '{"code":"..."}' },
});
const RETRY = JSON.stringify({
  type: 'llm/retry', seq: 800, time: 7,
  data: {
    retryId: '7f4f', turn: 5, step: 5, provider: 'openrouter', mode: 'normal',
    retry: 1, maxRetries: 5, delayMs: 472,
    failure: { message: 'no content', code: 'EMPTY_RESPONSE' },
  },
});
const REQUEST_HEADER = JSON.stringify({
  type: 'request/header', seq: 12, time: 8,
  data: { header: { config: { provider: 'openrouter', model: 'stealth/ox-alpha' }, system: '…' } },
});
const SESSION_TITLE = JSON.stringify({
  type: 'session/title', seq: 11, time: 9,
  data: { title: 'Repo aufräumen', messageSeqs: [7], source: { kind: 'fallback' } },
});
const TURN_END = JSON.stringify({
  type: 'turn/end', seq: 80, time: 10, data: { turn: 1, reason: { kind: 'completed' } },
});
const COMPACTION_END = JSON.stringify({
  type: 'compaction/end', seq: 900, time: 11, data: { compactionId: 'ceb0' },
});

describe('mapDshDispatchToolName', () => {
  it.each([
    ['bash', 'Bash'],
    ['read', 'Read'],
    ['edit', 'Edit'],
    ['write', 'Write'],
    ['glob', 'Glob'],
    ['grep', 'Grep'],
    ['todo_write', 'TodoWrite'],
    ['web_search', 'WebSearch'],
    ['read_image', 'Read'],
  ])('maps the %s dispatch onto the canonical tool', (dispatch, expected) => {
    expect(mapDshDispatchToolName(dispatch)).toBe(expected);
  });

  it('passes an unmapped dispatch through and guards against nothing', () => {
    expect(mapDshDispatchToolName('create_goal')).toBe('create_goal');
    expect(mapDshDispatchToolName(undefined)).toBe('tool');
  });
});

describe('projectDshRecord', () => {
  it('streams assistant text and reasoning', () => {
    expect(projectDshRecord(TEXT_DELTA, 0)?.chunks).toEqual([{ type: 'text', content: 'Hallo Welt' }]);
    expect(projectDshRecord(REASONING_DELTA, 0)?.chunks)
      .toEqual([{ type: 'thinking', content: 'denke nach' }]);
  });

  it('turns an inner dispatch into a tool call the chat can render', () => {
    expect(projectDshRecord(DISPATCH_START, 0)?.chunks).toEqual([{
      id: 'ca97:code:1',
      input: { command: 'ls -la', description: 'List repo root', workdir: '/vault' },
      name: 'Bash',
      type: 'tool_use',
    }]);
  });

  it('pairs the dispatch result to the same call id', () => {
    expect(projectDshRecord(DISPATCH_RESULT, 0)?.chunks).toEqual([{
      content: 'total 8080',
      id: 'ca97:code:1',
      type: 'tool_result',
    }]);
  });

  it('marks a failed dispatch as an error result', () => {
    const failed = JSON.stringify({
      type: 'tool/code-dispatch', seq: 458,
      data: { subCallId: 'x:code:2', name: 'bash', isError: true, content: [{ type: 'text', text: 'not found' }] },
    });

    expect(projectDshRecord(failed, 0)?.chunks).toEqual([{
      content: 'not found',
      id: 'x:code:2',
      isError: true,
      type: 'tool_result',
    }]);
  });

  // dsh wraps everything in one outer `run_code` call; rendering both levels
  // would show every action twice.
  it('skips the outer run_code call', () => {
    expect(projectDshRecord(OUTER_TOOL_CALL, 0)?.chunks).toEqual([]);
  });

  it('surfaces a provider retry as a warning notice', () => {
    const projected = projectDshRecord(RETRY, 0);

    expect(projected?.chunks).toEqual([{
      content: 'dsh wiederholt die Anfrage 1/5 — leere Antwort.',
      level: 'warning',
      type: 'notice',
    }]);
    expect(projected?.metadata.retries).toBe(1);
  });

  it('reports an unknown retry code verbatim instead of inventing a reason', () => {
    const unknown = JSON.stringify({
      type: 'llm/retry', seq: 801,
      data: { retry: 2, maxRetries: 5, failure: { code: 'QUOTA_GONE' } },
    });

    expect((projectDshRecord(unknown, 0)?.chunks[0] as { content: string }).content)
      .toBe('dsh wiederholt die Anfrage 2/5 — QUOTA_GONE.');
  });

  it('reports the provider and model dsh actually used', () => {
    expect(projectDshRecord(REQUEST_HEADER, 0)?.metadata)
      .toEqual({ model: 'stealth/ox-alpha', provider: 'openrouter' });
  });

  it('picks up the session title and the terminal reason', () => {
    expect(projectDshRecord(SESSION_TITLE, 0)?.metadata.title).toBe('Repo aufräumen');
    expect(projectDshRecord(TURN_END, 0)?.metadata.endReason).toBe('completed');
  });

  it('signals context compaction', () => {
    expect(projectDshRecord(COMPACTION_END, 0)?.chunks).toEqual([{ type: 'context_compacted' }]);
  });

  it('collects real token counts instead of emitting a chunk', () => {
    const projected = projectDshRecord(USAGE, 0);

    expect(projected?.chunks).toEqual([]);
    expect(projected?.metadata.usage).toEqual({ inputTokens: 15776, outputTokens: 174 });
  });

  it('ignores structural chunks, broken lines and already-seen records', () => {
    const blockStart = JSON.stringify({
      type: 'assistant/chunk', seq: 5, data: { chunk: { type: 'block-start', index: 0 } },
    });

    expect(projectDshRecord(blockStart, 0)?.chunks).toEqual([]);
    expect(projectDshRecord('garbage', 0)).toBeNull();
    expect(projectDshRecord('', 0)).toBeNull();
    expect(projectDshRecord(TEXT_DELTA, 19)).toBeNull();
  });

  it('renames a dispatch path argument onto the shared file_path key', () => {
    const read = JSON.stringify({
      type: 'tool/code-dispatch-start', seq: 460,
      data: { subCallId: 'r:code:1', name: 'read', arguments: { path: 'notes/a.md' } },
    });

    expect((projectDshRecord(read, 0)?.chunks[0] as { input: Record<string, unknown> }).input)
      .toEqual({ file_path: 'notes/a.md', path: 'notes/a.md' });
  });
});

describe('projectDshTranscript', () => {
  // Records are appended in ascending `seq`, which is what makes a monotonic
  // watermark safe; the fixture order mirrors that.
  it('projects a whole slice in order and advances the watermark', () => {
    const jsonl = ['', REQUEST_HEADER, TEXT_DELTA, REASONING_DELTA, USAGE, DISPATCH_START, DISPATCH_RESULT].join('\n');

    const projection = projectDshTranscript(jsonl, 0);

    expect(projection.chunks.map((chunk) => chunk.type)).toEqual([
      'text', 'thinking', 'tool_use', 'tool_result',
    ]);
    expect(projection.lastSeq).toBe(457);
    expect(projection.metadata).toMatchObject({
      model: 'stealth/ox-alpha',
      usage: { inputTokens: 15776, outputTokens: 174 },
    });
  });

  it('is idempotent when the same slice is read again', () => {
    const jsonl = [TEXT_DELTA, REASONING_DELTA].join('\n');
    const first = projectDshTranscript(jsonl, 0);

    expect(projectDshTranscript(jsonl, first.lastSeq).chunks).toEqual([]);
  });
});

describe('buildDshUsageInfo', () => {
  it('reports measured usage as authoritative', () => {
    expect(buildDshUsageInfo(
      { model: 'stealth/ox-alpha', usage: { inputTokens: 15776, outputTokens: 174 } },
      128_000,
    )).toEqual({
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      contextTokens: 15_950,
      contextWindow: 128_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 15_776,
      model: 'stealth/ox-alpha',
      outputTokens: 174,
      percentage: 12,
    });
  });

  it('returns nothing when dsh reported no tokens', () => {
    expect(buildDshUsageInfo({}, 128_000)).toBeNull();
  });

  it('does not divide by an unknown context window', () => {
    expect(buildDshUsageInfo({ usage: { inputTokens: 10, outputTokens: 5 } }, 0)?.percentage).toBe(0);
  });
});
