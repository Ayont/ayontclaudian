import { EventEmitter } from 'node:events';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { estimateTokensForTexts } from '@/core/providers/usage/estimateUsage';
import type { ChatMessage, StreamChunk, UsageInfo } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { GrokChatRuntime } from '@/providers/grok/runtime/GrokChatRuntime';

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('node:child_process') as { spawn: jest.Mock };

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: jest.Mock };
  exitCode: number | null;
  kill: jest.Mock;
  pid: number;
}

function makeFakeProcess(pid: number): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: jest.fn() };
  proc.exitCode = null;
  proc.kill = jest.fn();
  proc.pid = pid;
  return proc;
}

function makePlugin(): ClaudianPlugin {
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/grok-vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        grok: {
          enabled: true,
          cliPath: '/bin/grok',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/grok'),
  } as unknown as ClaudianPlugin;
}

function makeTurn(text: string): Parameters<GrokChatRuntime['query']>[0] {
  return {
    isCompact: false,
    mcpMentions: new Set<string>(),
    persistedContent: '',
    prompt: text,
    request: { text },
  } as Parameters<GrokChatRuntime['query']>[0];
}

function promptFromSpawnCall(callIndex: number): string {
  const args = spawn.mock.calls[callIndex][1] as string[];
  const promptIndex = args.indexOf('-p');
  return args[promptIndex + 1];
}

function findLastUsage(chunks: StreamChunk[]): UsageInfo | undefined {
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk.type === 'usage') {
      return chunk.usage;
    }
  }
  return undefined;
}

function finishProcess(
  proc: FakeProcess,
  options: { code: number; stderr?: string; stdout?: string },
): void {
  setImmediate(() => {
    if (options.stdout) {
      proc.stdout.emit('data', Buffer.from(options.stdout, 'utf-8'));
    }
    if (options.stderr) {
      proc.stderr.emit('data', Buffer.from(options.stderr, 'utf-8'));
    }
    proc.exitCode = options.code;
    proc.emit('close', options.code);
  });
}

describe('GrokChatRuntime bot isolation', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['explore', 'review', false],
    ['explore', '', false],
    [undefined, 'review', false],
    ['review', 'review', true],
  ])('isolates persisted bot %s from selected bot %s', async (previous, selected, resumes) => {
    spawn.mockReset();
    jest.spyOn(ProviderWorkspaceRegistry, 'getServices').mockReturnValue({
      agentCatalog: {
        isLoaded: () => true,
        refresh: async () => {},
        getLastError: () => null,
        resolveAgentName: (name: string) => name,
      },
    } as unknown as ReturnType<typeof ProviderWorkspaceRegistry.getServices>);
    const plugin = makePlugin();
    plugin.settings.providerConfigs.grok = { ...plugin.settings.providerConfigs.grok, botName: selected };
    const proc = makeFakeProcess(4301);
    spawn.mockImplementation(() => {
      finishProcess(proc, { code: 0, stdout: '{"type":"text","data":"Hallo"}\n{"type":"end","sessionId":"new-session"}\n' });
      return proc;
    });
    const runtime = new GrokChatRuntime(plugin);
    runtime.syncConversationState({ sessionId: null, providerState: { sessionId: 'old-session', botName: previous } });
    for await (const chunk of runtime.query(makeTurn('Hallo'))) { void chunk; }
    const args = spawn.mock.calls[0][1] as string[];
    expect(args.includes('-r')).toBe(resumes);
    expect(args.includes('--agent')).toBe(Boolean(selected));
    expect(args[args.indexOf('--agent') + 1]).toBe(selected || '--output-format');
    expect(runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false }).updates.providerState)
      .toEqual({ sessionId: 'new-session', botName: selected || null });
  });

  it('refuses an unverified configured bot instead of launching the default', async () => {
    spawn.mockReset();
    jest.spyOn(ProviderWorkspaceRegistry, 'getServices').mockReturnValue(null);
    const plugin = makePlugin();
    plugin.settings.providerConfigs.grok = { ...plugin.settings.providerConfigs.grok, botName: 'missing-bot' };
    const proc = makeFakeProcess(4300);
    spawn.mockImplementation(() => {
      finishProcess(proc, { code: 0, stdout: '{"type":"text","data":"Wrong bot"}\n' });
      return proc;
    });
    const chunks: StreamChunk[] = [];
    for await (const chunk of new GrokChatRuntime(plugin).query(makeTurn('Hallo'))) chunks.push(chunk);
    expect(spawn).not.toHaveBeenCalled();
    expect(chunks).toEqual([
      { type: 'error', content: expect.stringContaining('Bot') },
      { type: 'done' },
    ]);
  });
});

describe('GrokChatRuntime process lifecycle', () => {
  beforeEach(() => spawn.mockReset());

  it('cancels before spawning when stopped at the user-start boundary', async () => {
    const runtime = new GrokChatRuntime(makePlugin());
    const proc = makeFakeProcess(4401);
    spawn.mockImplementation(() => {
      finishProcess(proc, { code: 0 });
      return proc;
    });
    const stream = runtime.query(makeTurn('Hallo'));
    expect((await stream.next()).value?.type).toBe('user_message_start');
    runtime.cancel();
    const chunks: StreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(spawn.mock.calls.length).toBe(0);
    expect(chunks).toEqual([{ type: 'done' }]);
  });

  it('wakes a cancelled stream even when the child never emits close', async () => {
    const runtime = new GrokChatRuntime(makePlugin());
    const proc = makeFakeProcess(4402);
    spawn.mockReturnValue(proc);
    const stream = runtime.query(makeTurn('Hallo'));
    await stream.next();
    const pending = stream.next();
    await new Promise<void>(resolve => setImmediate(resolve));
    runtime.cancel();
    proc.stdout.emit('data', '{"type":"end","sessionId":"cancelled-session"}\n');
    expect(runtime.getSessionId()).toBeNull();
    const result = await Promise.race([
      pending,
      new Promise<string>(resolve => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(result).toEqual({ value: { type: 'done' }, done: false });
    await stream.return(undefined);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runtime.consumeTurnMetadata().wasSent).not.toBe(true);
  });

  it('does not recover a buffered session id when close races cancellation', async () => {
    const runtime = new GrokChatRuntime(makePlugin());
    const proc = makeFakeProcess(4406);
    spawn.mockReturnValue(proc);
    const stream = runtime.query(makeTurn('Hallo'));
    await stream.next();
    const pending = stream.next();
    await new Promise<void>(resolve => setImmediate(resolve));
    proc.stdout.emit('data', '{"type":"end","sessionId":"cancelled-session"}');
    runtime.cancel();
    proc.emit('close', 0);
    expect(runtime.getSessionId()).toBeNull();
    expect(await pending).toEqual({ value: { type: 'done' }, done: false });
    await stream.return(undefined);
  });

  it('terminates and detaches stdout when the consumer closes the stream early', async () => {
    const runtime = new GrokChatRuntime(makePlugin());
    const proc = makeFakeProcess(4403);
    spawn.mockReturnValue(proc);
    const stream = runtime.query(makeTurn('Hallo'));
    await stream.next();
    const pending = stream.next();
    await new Promise<void>(resolve => setImmediate(resolve));
    proc.stdout.emit('data', '{"type":"text","data":"partial"}\n');
    await pending;
    await stream.return(undefined);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(proc.stdout.listenerCount('data')).toBe(0);
  });

  it('force-kills a child that ignores cancellation and cancels the timer on close', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const runtime = new GrokChatRuntime(makePlugin());
      const proc = makeFakeProcess(4404);
      spawn.mockReturnValue(proc);
      const stream = runtime.query(makeTurn('Hallo'));
      await stream.next();
      const pending = stream.next();
      await new Promise<void>(resolve => setImmediate(resolve));
      runtime.cancel();
      await pending;
      await stream.return(undefined);
      jest.advanceTimersByTime(2000);
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
      proc.emit('close', null);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not restart a stale session after cancellation at the retry notice', async () => {
    const runtime = new GrokChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'stale' }, sessionId: null });
    spawn.mockImplementation(() => {
      const proc = makeFakeProcess(4405);
      finishProcess(proc, { code: 1, stderr: 'Error: unknown session' });
      return proc;
    });
    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn('Hallo'))) {
      chunks.push(chunk);
      if (chunk.type === 'notice') runtime.cancel();
    }
    expect(spawn.mock.calls.length).toBe(1);
    expect(chunks.filter(chunk => chunk.type === 'error')).toHaveLength(0);
    expect(chunks.filter(chunk => chunk.type === 'done')).toHaveLength(1);
  });

  it.each(['empty', 'signal', 'error-close'])('reports %s as failure, never successful usage', async (scenario) => {
    const proc = makeFakeProcess(4400);
    spawn.mockImplementation(() => {
      setImmediate(() => {
        if (scenario === 'error-close') proc.emit('error', new Error('spawn failed'));
        proc.exitCode = scenario === 'signal' ? null : 0;
        proc.emit('close', proc.exitCode, scenario === 'signal' ? 'SIGKILL' : null);
      });
      return proc;
    });
    const runtime = new GrokChatRuntime(makePlugin());
    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn('Hallo'))) chunks.push(chunk);
    expect(chunks.filter(chunk => chunk.type === 'error')).toHaveLength(1);
    expect(chunks).toContainEqual({
      type: 'error',
      content: expect.stringMatching(scenario === 'error-close' ? /^spawn failed$/ : /\S/),
    });
    expect(chunks.filter(chunk => chunk.type === 'usage')).toHaveLength(0);
    expect(chunks.filter(chunk => chunk.type === 'done')).toHaveLength(1);
    expect(runtime.consumeTurnMetadata().wasSent).not.toBe(true);
  });
});

describe('GrokChatRuntime stale-session history recovery', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('replays bounded visible history only on the fresh retry and preserves the current contracts', async () => {
    const staleProcess = makeFakeProcess(4201);
    const retryProcess = makeFakeProcess(4202);
    spawn
      .mockImplementationOnce(() => {
        finishProcess(staleProcess, { code: 1, stderr: 'Error: unknown session' });
        return staleProcess;
      })
      .mockImplementationOnce(() => {
        finishProcess(retryProcess, {
          code: 0,
          stdout: [
            JSON.stringify({ type: 'text', data: 'Wiederhergestellt.' }),
            JSON.stringify({ type: 'end', sessionId: 'grok-fresh', stopReason: 'EndTurn' }),
            '',
          ].join('\n'),
        });
        return retryProcess;
      });

    const currentPrompt = [
      'Dokument weiterführen.',
      '',
      '<claudian_output_contract>',
      'surface=live-document',
      '</claudian_output_contract>',
      '',
      '<standing_goal>',
      'Dokument vollständig liefern.',
      '</standing_goal>',
    ].join('\n');
    const history: ChatMessage[] = [
      {
        id: 'old-user',
        role: 'user',
        content: '<vault_context>\nINTERNER RAG-TEXT\n</vault_context>\n\nAlte Frage',
        timestamp: 1,
      },
      {
        id: 'old-assistant',
        role: 'assistant',
        content: 'Alte Antwort',
        timestamp: 2,
      },
      {
        id: 'current-user',
        role: 'user',
        content: currentPrompt,
        displayContent: 'Dokument weiterführen.',
        timestamp: 3,
      },
    ];
    const runtime = new GrokChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'grok-stale' }, sessionId: null });

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn(currentPrompt), history)) {
      chunks.push(chunk);
    }

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(promptFromSpawnCall(0)).toBe(currentPrompt);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-r', 'grok-stale']));

    const retryPrompt = promptFromSpawnCall(1);
    expect(spawn.mock.calls[1][1]).not.toContain('-r');
    expect(retryPrompt).toContain('User: Alte Frage');
    expect(retryPrompt).toContain('Assistant: Alte Antwort');
    expect(retryPrompt).not.toContain('INTERNER RAG-TEXT');
    expect(retryPrompt.match(/Dokument weiterführen\./g)).toHaveLength(1);
    expect(retryPrompt).toContain('<claudian_output_contract>\nsurface=live-document');
    expect(retryPrompt).toContain('<standing_goal>\nDokument vollständig liefern.');
    expect(chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage?.reportType).toBe('final');
    expect(finalUsage?.contextTokens).toBe(estimateTokensForTexts([
      retryPrompt,
      'Wiederhergestellt.',
    ]));
  });

  it('keeps an ordinary successful native resume free of replayed history', async () => {
    const proc = makeFakeProcess(4203);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, {
        code: 0,
        stdout: [
          JSON.stringify({ type: 'text', data: 'Antwort.' }),
          JSON.stringify({ type: 'end', sessionId: 'grok-live', stopReason: 'EndTurn' }),
          '',
        ].join('\n'),
      });
      return proc;
    });

    const runtime = new GrokChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'grok-live' }, sessionId: null });
    const history: ChatMessage[] = [
      { id: 'old-user', role: 'user', content: 'Nicht erneut senden', timestamp: 1 },
      { id: 'old-assistant', role: 'assistant', content: 'Vorige Antwort', timestamp: 2 },
    ];
    const chunks: StreamChunk[] = [];

    for await (const chunk of runtime.query(makeTurn('Nur der aktuelle Prompt'), history)) {
      chunks.push(chunk);
    }

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(promptFromSpawnCall(0)).toBe('Nur der aktuelle Prompt');
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['-r', 'grok-live']));
    expect(chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage?.reportType).toBe('final');
    expect(finalUsage?.contextTokens).toBe(estimateTokensForTexts([
      ...history.map((message) => message.content ?? ''),
      'Nur der aktuelle Prompt',
      'Antwort.',
    ]));
  });

  it('uses the CLI usage ledger and 500K window instead of a character estimate', async () => {
    const proc = makeFakeProcess(4304);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, {
        code: 0,
        stdout: [
          JSON.stringify({ type: 'text', data: 'Antwort.' }),
          JSON.stringify({
            type: 'end',
            sessionId: 'grok-usage',
            stopReason: 'end_turn',
            usage: {
              input_tokens: 1000,
              cache_read_input_tokens: 4000,
              cache_creation_input_tokens: 0,
              output_tokens: 50,
            },
            modelUsage: {
              'grok-4.7': { contextWindow: 500000, inputTokens: 1000, outputTokens: 50 },
            },
          }),
          '',
        ].join('\n'),
      });
      return proc;
    });

    const plugin = makePlugin();
    (plugin.settings as { effortLevel?: string; model?: string }).effortLevel = 'xhigh';
    (plugin.settings as { model?: string }).model = 'grok-4.7';
    const chunks: StreamChunk[] = [];
    for await (const chunk of new GrokChatRuntime(plugin).query(makeTurn('Hallo'), undefined, { model: 'grok-4.7' })) {
      chunks.push(chunk);
    }

    const args = spawn.mock.calls[0][1] as string[];
    expect(args).toEqual(expect.arrayContaining(['-m', 'grok-4.7', '--reasoning-effort', 'xhigh']));
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage).toMatchObject({
      contextTokens: 5000,
      contextWindow: 500_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 1000,
      cacheReadInputTokens: 4000,
      outputTokens: 50,
      percentage: 1,
      reportType: 'final',
      model: 'grok-4.7',
    });
  });

  it('surfaces a streamed rate-limit error once', async () => {
    const proc = makeFakeProcess(4305);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, {
        code: 1,
        stderr: 'rate_limit',
        stdout: `${JSON.stringify({ type: 'error', message: 'rate_limit: usage limit reached' })}\n`,
      });
      return proc;
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of new GrokChatRuntime(makePlugin()).query(makeTurn('Hallo'))) {
      chunks.push(chunk);
    }

    const errors = chunks.filter((chunk) => chunk.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ content: 'rate_limit: usage limit reached' });
  });
});
