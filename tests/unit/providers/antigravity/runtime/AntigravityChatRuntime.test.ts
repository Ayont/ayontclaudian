import { EventEmitter } from 'node:events';

import { estimateTokensForTexts } from '@/core/providers/usage/estimateUsage';
import type { ChatMessage, StreamChunk, UsageInfo } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { AntigravityChatRuntime } from '@/providers/antigravity/runtime/AntigravityChatRuntime';

jest.mock('node:child_process', () => ({
  exec: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock('@/providers/antigravity/history/AntigravityBrainStore', () => ({
  discoverNewestConversationId: jest.fn(() => null),
  getAntigravityTranscriptPath: jest.fn((id: string) => `/brain/${id}/transcript.jsonl`),
  hasAntigravityTranscript: jest.fn(() => true),
  readAntigravityTranscript: jest.fn(() => null),
  readAntigravityTranscriptIfChanged: jest.fn(() => null),
  snapshotBrainConversationIds: jest.fn(() => new Set<string>()),
  splitTranscriptLines: jest.fn(() => []),
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
          basePath: '/tmp/antigravity-vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        antigravity: {
          enabled: true,
          cliPath: '/bin/agy',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/agy'),
  } as unknown as ClaudianPlugin;
}

function makeTurn(text: string): Parameters<AntigravityChatRuntime['query']>[0] {
  return {
    isCompact: false,
    mcpMentions: new Set<string>(),
    persistedContent: '',
    prompt: text,
    request: { text },
  } as Parameters<AntigravityChatRuntime['query']>[0];
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
    proc.emit('exit', options.code);
  });
}

describe('AntigravityChatRuntime stale-conversation history recovery', () => {
  beforeEach(() => {
    spawn.mockReset();
  });

  it('replays bounded visible history only on the fresh retry and preserves current contracts', async () => {
    const staleProcess = makeFakeProcess(4301);
    const retryProcess = makeFakeProcess(4302);
    spawn
      .mockImplementationOnce(() => {
        finishProcess(staleProcess, { code: 1, stderr: 'Error: conversation not found' });
        return staleProcess;
      })
      .mockImplementationOnce(() => {
        finishProcess(retryProcess, { code: 0, stdout: 'Wiederhergestellt.' });
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
    const runtime = new AntigravityChatRuntime(makePlugin());
    runtime.syncConversationState({
      providerState: { conversationId: 'agy-stale' },
      sessionId: null,
    });

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn(currentPrompt), history)) {
      chunks.push(chunk);
    }

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(promptFromSpawnCall(0)).toBe(currentPrompt);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--conversation', 'agy-stale']));

    const retryPrompt = promptFromSpawnCall(1);
    expect(spawn.mock.calls[1][1]).not.toContain('--conversation');
    expect(retryPrompt).toContain('User: Alte Frage');
    expect(retryPrompt).toContain('Assistant: Alte Antwort');
    expect(retryPrompt).not.toContain('INTERNER RAG-TEXT');
    expect(retryPrompt.match(/Dokument weiterführen\./g)).toHaveLength(1);
    expect(retryPrompt).toContain('<claudian_output_contract>\nsurface=live-document');
    expect(retryPrompt).toContain('<standing_goal>\nDokument vollständig liefern.');
    expect(chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage?.contextTokens).toBe(estimateTokensForTexts([
      retryPrompt,
      'Wiederhergestellt.',
    ]));
  });

  it('keeps an ordinary successful native resume free of replayed history', async () => {
    const proc = makeFakeProcess(4303);
    spawn.mockImplementationOnce(() => {
      finishProcess(proc, { code: 0, stdout: 'Antwort.' });
      return proc;
    });

    const runtime = new AntigravityChatRuntime(makePlugin());
    runtime.syncConversationState({
      providerState: { conversationId: 'agy-live' },
      sessionId: null,
    });
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
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--conversation', 'agy-live']));
    expect(chunks.filter((chunk) => chunk.type === 'user_message_start')).toHaveLength(1);
    const finalUsage = findLastUsage(chunks);
    expect(finalUsage?.contextTokens).toBe(estimateTokensForTexts([
      ...history.map((message) => message.content ?? ''),
      'Nur der aktuelle Prompt',
      'Antwort.',
    ]));
  });
});
