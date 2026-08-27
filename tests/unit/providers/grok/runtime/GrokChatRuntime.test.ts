import { EventEmitter } from 'node:events';

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
});
