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

describe('AntigravityChatRuntime stream/transcript interleaving', () => {
  // Real agy 1.1.24 behaviour (captured 2026-09-02): stream-json emits
  // agent_response text_delta chunks immediately, while the transcript's
  // PLANNER_RESPONSE row — the only carrier of `thinking` — lands later. Without
  // ordering, the thinking chunk arrived AFTER the first text delta and split an
  // open ```powershell fence in two.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const brain = require('@/providers/antigravity/history/AntigravityBrainStore') as {
    readAntigravityTranscriptIfChanged: jest.Mock;
    splitTranscriptLines: jest.Mock;
  };

  beforeEach(() => {
    spawn.mockReset();
    brain.readAntigravityTranscriptIfChanged.mockReset().mockReturnValue(null);
    brain.splitTranscriptLines.mockReset().mockReturnValue([]);
  });

  it('emits transcript thinking before the streamed text of the same answer, never in between', async () => {
    const proc = makeFakeProcess(4401);
    const cid = 'agy-think';
    const stream = [
      JSON.stringify({ event: 'init', conversation_id: cid, init: {} }),
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '```powershel' } }),
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: cid, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'l\nGet-ChildItem *.log\n```\n' } }),
      JSON.stringify({ event: 'result', conversation_id: cid, status: 'SUCCESS', response: '', usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 3, cache_read_tokens: 0, total_tokens: 15 } }),
    ].join('\n') + '\n';

    const transcriptRows = [
      JSON.stringify({ type: 'USER_INPUT', step_index: 0, status: 'DONE', content: 'frage' }),
      JSON.stringify({ type: 'PLANNER_RESPONSE', step_index: 1, status: 'DONE', thinking: '**Listing**\n\nRecursive search.', content: '```powershell\nGet-ChildItem *.log\n```' }),
    ];
    // agy writes the planner row (with thinking) while the answer is still
    // streaming: first stream delta → poll sees transcript → second delta.
    const lines = stream.split('\n').filter(Boolean);
    let transcriptVisible = false;
    brain.readAntigravityTranscriptIfChanged.mockImplementation(() => (
      transcriptVisible ? { stat: { size: 1, mtimeMs: 1 }, buffer: transcriptRows.join('\n') } : null
    ));
    brain.splitTranscriptLines.mockImplementation((buffer: string) => buffer.split('\n'));

    spawn.mockImplementationOnce(() => {
      setImmediate(() => {
        proc.stdout.emit('data', Buffer.from(`${lines[0]}\n${lines[1]}\n`, 'utf-8'));
        setTimeout(() => { transcriptVisible = true; }, 150);
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(`${lines[2]}\n${lines[3]}\n`, 'utf-8'));
          proc.exitCode = 0;
          proc.emit('exit', 0);
        }, 400);
      });
      return proc;
    });

    const runtime = new AntigravityChatRuntime(makePlugin());
    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(makeTurn('frage'), [])) {
      chunks.push(chunk);
    }

    const order = chunks.filter((c) => c.type === 'text' || c.type === 'thinking').map((c) => c.type);
    expect(order.filter((t) => t === 'thinking')).toHaveLength(1);
    const firstText = order.indexOf('text');
    const thinkingAt = order.indexOf('thinking');
    // Thinking must not land inside the text run.
    expect(thinkingAt < firstText || thinkingAt > order.lastIndexOf('text')).toBe(true);
    const text = chunks.filter((c) => c.type === 'text').map((c) => (c as { content: string }).content).join('');
    expect(text).toBe('```powershell\nGet-ChildItem *.log\n```\n');
  });
  it("stages multiple images with duplicate or identical names to distinct files without collision", async () => {
    const proc = makeFakeProcess(5501);
    const stream = [
      JSON.stringify({ event: "init", conversation_id: "agy-multi", init: {} }),
      JSON.stringify({ event: "result", conversation_id: "agy-multi", status: "SUCCESS", response: "Analysiert", usage: { total_tokens: 10 } }),
    ].join("\n") + "\n";

    spawn.mockImplementationOnce(() => {
      setImmediate(() => {
        proc.stdout.emit("data", Buffer.from(stream, "utf-8"));
        proc.exitCode = 0;
        proc.emit("exit", 0);
      });
      return proc;
    });

    const runtime = new AntigravityChatRuntime(makePlugin());
    const turn = {
      isCompact: false,
      mcpMentions: new Set<string>(),
      persistedContent: "",
      prompt: "Analysiere diese 6 Bilder",
      request: {
        text: "Analysiere diese 6 Bilder",
        images: [
          { name: "image.png", mediaType: "image/png", data: "AQID" },
          { name: "image.png", mediaType: "image/png", data: "BAUG" },
          { name: "image.png", mediaType: "image/png", data: "BwgJ" },
          { name: "screenshot.jpg", mediaType: "image/jpeg", data: "CgsM" },
          { name: "screenshot.jpg", mediaType: "image/jpeg", data: "DQ4P" },
          { name: "chart.png", mediaType: "image/png", data: "EBEc" },
        ],
      },
    } as Parameters<AntigravityChatRuntime["query"]>[0];

    const chunks: StreamChunk[] = [];
    for await (const chunk of runtime.query(turn, [])) {
      chunks.push(chunk);
    }

    expect(spawn).toHaveBeenCalledTimes(1);
    const promptArg = promptFromSpawnCall(0);

    // Prompt contains 6 @-references
    const mentionMatches = promptArg.match(/@([^\s]+)/g);
    expect(mentionMatches).toHaveLength(6);

    // Ensure all 6 paths are distinct
    const uniquePaths = new Set(mentionMatches);
    expect(uniquePaths.size).toBe(6);
  });
});
