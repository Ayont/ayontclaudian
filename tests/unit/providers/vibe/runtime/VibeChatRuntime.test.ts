import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { estimateTokensForTexts } from '@/core/providers/usage/estimateUsage';
import type { ChatMessage, StreamChunk, UsageInfo } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { VibeChatRuntime } from '@/providers/vibe/runtime/VibeChatRuntime';

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
          basePath: '/tmp/vibe-vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        vibe: {
          enabled: true,
          cliPath: '/bin/vibe',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/vibe'),
  } as unknown as ClaudianPlugin;
}

function makeTurn(text: string): Parameters<VibeChatRuntime['query']>[0] {
  return {
    isCompact: false,
    mcpMentions: new Set<string>(),
    persistedContent: '',
    prompt: text,
    request: { text },
  } as Parameters<VibeChatRuntime['query']>[0];
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

describe('VibeChatRuntime stale-session history recovery', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('replays bounded visible history only on the fresh retry and preserves the current contracts', async () => {
    const staleProcess = makeFakeProcess(4101);
    const retryProcess = makeFakeProcess(4102);
    spawn
      .mockImplementationOnce(() => {
        finishProcess(staleProcess, { code: 1, stderr: 'Error: session not found' });
        return staleProcess;
      })
      .mockImplementationOnce(() => {
        finishProcess(retryProcess, {
          code: 0,
          stdout: `${JSON.stringify({
            role: 'assistant',
            content: 'Wiederhergestellt.',
            session_id: 'vibe-fresh',
          })}\n`,
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
    const runtime = new VibeChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'vibe-stale' }, sessionId: null });

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn(currentPrompt), history)) {
      chunks.push(chunk);
    }

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(promptFromSpawnCall(0)).toBe(currentPrompt);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--resume', 'vibe-stale']));

    const retryPrompt = promptFromSpawnCall(1);
    expect(spawn.mock.calls[1][1]).not.toContain('--resume');
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
    const proc = makeFakeProcess(4103);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, {
        code: 0,
        stdout: `${JSON.stringify({ role: 'assistant', content: 'Antwort.' })}\n`,
      });
      return proc;
    });

    const runtime = new VibeChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'vibe-live' }, sessionId: null });
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
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--resume', 'vibe-live']));
    expect(chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage?.reportType).toBe('final');
    expect(finalUsage?.contextTokens).toBe(estimateTokensForTexts([
      ...history.map((message) => message.content ?? ''),
      'Nur der aktuelle Prompt',
      'Antwort.',
    ]));
  });
});

describe('VibeChatRuntime with vibe 2.25.8 streaming entries', () => {
  const originalHome = process.env.VIBE_HOME;
  let home: string;

  const SESSION = '7d9fe80c-6e47-829c-68c2-2a48ddd7ca53';
  const entry = (fields: Record<string, unknown>): string => JSON.stringify({
    sessionId: SESSION, turnId: 't2', createdAt: Date.now() + 60_000, updatedAt: 0,
    generationStatus: 'completed', relatedEntryId: null, ...fields,
  });

  function writeMeta(sessionId: string, contextTokens: number): void {
    const dir = path.join(home, 'logs', 'session', `session_20260924_150000_${sessionId.slice(0, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ session_id: sessionId, stats: { context_tokens: contextTokens } }));
  }

  async function run(stdout: string): Promise<{ chunks: StreamChunk[]; runtime: VibeChatRuntime }> {
    const proc = makeFakeProcess(4201);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, { code: 0, stdout });
      return proc;
    });
    const runtime = new VibeChatRuntime(makePlugin());
    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn('weiter'), [])) {
      chunks.push(chunk);
    }
    return { chunks, runtime };
  }

  beforeEach(() => {
    spawn.mockReset();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-vibe-runtime-'));
    process.env.VIBE_HOME = home;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.VIBE_HOME;
    else process.env.VIBE_HOME = originalHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('skips the history vibe replays before a resumed turn', async () => {
    const old = JSON.stringify({
      sessionId: SESSION, turnId: 't1', createdAt: 1_000, updatedAt: 1_000, generationStatus: 'completed', relatedEntryId: null,
      id: 'm-old', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ALTE ANTWORT' }],
    });
    const fresh = entry({ id: 'm-new', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Neue Antwort.' }] });

    const { chunks } = await run(`${old}\n${fresh}\n`);

    const text = chunks.filter((chunk) => chunk.type === 'text').map((chunk) => (chunk as { content: string }).content).join('');
    expect(text).toBe('Neue Antwort.');
  });

  it('keeps the camelCase session id for the next resume', async () => {
    const { runtime } = await run(`${entry({ id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }] })}\n`);

    expect(runtime.getSessionId()).toBe(SESSION);
  });

  it('reports the fill vibe measured instead of an estimate', async () => {
    writeMeta(SESSION, 48_200);

    const { chunks } = await run(`${entry({ id: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }] })}\n`);

    expect(findLastUsage(chunks)).toMatchObject({ contextTokens: 48_200, reportType: 'final' });
  });

  it('follows vibe into the compacted session and keeps the unknown fill off the meter', async () => {
    const NEXT = 'aa11bb22-0000-0000-0000-000000000000';
    writeMeta(NEXT, 0);
    const checkpoint = entry({ id: 'cp', type: 'checkpoint', kind: 'compaction', message: 'Context compacted', details: { oldSessionId: SESSION, newSessionId: NEXT } });

    const { chunks, runtime } = await run(`${checkpoint}\n`);

    expect(chunks).toContainEqual({ type: 'context_compacted' });
    expect(runtime.getSessionId()).toBe(NEXT);
    const usage = chunks.filter((chunk) => chunk.type === 'usage').pop();
    expect(usage).toMatchObject({ contextDisplay: 'preserve' });
  });
});
