/**
 * Regression: Kimi K3 watchdog timeouts.
 *
 * kimi-cli stream-json emits ONE complete message per NDJSON line — long
 * reasoning phases are totally silent on stdout even though the CLI is
 * healthy. The chat stream watchdog treats 120s of chunk silence as a hang
 * and force-cancelled working turns ("Timeout nach 2 automatischen
 * Versuchen"). The runtime now emits `{ type: 'keepalive' }` heartbeats while
 * the process is alive so the watchdog keeps waiting.
 */
import { EventEmitter } from 'node:events';

import type { StreamChunk } from '@/core/types';
import type ClaudianPlugin from '@/main';
import { KIMI_KEEPALIVE_INTERVAL_MS } from '@/providers/kimi/runtime/keepalive';
import { KimiChatRuntime } from '@/providers/kimi/runtime/KimiChatRuntime';

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

function makeFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { end: jest.fn() };
  proc.exitCode = null;
  proc.kill = jest.fn();
  proc.pid = 4242;
  return proc;
}

function makePlugin(): ClaudianPlugin {
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        kimi: {
          enabled: true,
          cliPath: '/bin/kimi',
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/kimi'),
  } as unknown as ClaudianPlugin;
}

function makeTurn(text: string): Parameters<KimiChatRuntime['query']>[0] {
  return {
    isCompact: false,
    mcpMentions: new Set<string>(),
    persistedContent: '',
    prompt: text,
    request: { text },
  } as unknown as Parameters<KimiChatRuntime['query']>[0];
}

describe('KimiChatRuntime keepalive heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    spawn.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('emits keepalive chunks while the process is alive but silent', async () => {
    const proc = makeFakeProcess();
    spawn.mockReturnValue(proc);

    const runtime = new KimiChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: {}, sessionId: null });

    const generator = runtime.query(makeTurn('Denke lange nach.'));

    const first = await generator.next();
    expect((first.value as StreamChunk).type).toBe('user_message_start');

    // No stdout activity — after one interval the runtime must heartbeat.
    const pending = generator.next();
    await jest.advanceTimersByTimeAsync(KIMI_KEEPALIVE_INTERVAL_MS + 1);
    const heartbeat = await pending;
    expect((heartbeat.value as StreamChunk).type).toBe('keepalive');

    // Still silent — the next interval produces another heartbeat.
    const pendingSecond = generator.next();
    await jest.advanceTimersByTimeAsync(KIMI_KEEPALIVE_INTERVAL_MS + 1);
    expect(((await pendingSecond).value as StreamChunk).type).toBe('keepalive');

    // Process exits cleanly → usage + done, generator completes, timer cleared.
    const rest: StreamChunk[] = [];
    const drain = (async () => {
      for await (const chunk of { [Symbol.asyncIterator]: () => generator }) {
        rest.push(chunk);
      }
    })();
    proc.emit('close', 0);
    await drain;

    expect(rest.map((chunk) => chunk.type)).toEqual(['usage', 'done']);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('yields real output between heartbeats unchanged', async () => {
    const proc = makeFakeProcess();
    spawn.mockReturnValue(proc);

    const runtime = new KimiChatRuntime(makePlugin());
    runtime.syncConversationState({ providerState: {}, sessionId: null });

    const generator = runtime.query(makeTurn('Hallo'));
    await generator.next(); // user_message_start

    const pending = generator.next();
    proc.stdout.emit(
      'data',
      Buffer.from(`${JSON.stringify({ content: 'Antwort.', role: 'assistant' })}\n`, 'utf-8'),
    );
    const chunk = await pending;
    expect(chunk.value).toEqual({ content: 'Antwort.', type: 'text' });

    proc.emit('close', 0);
    const rest: StreamChunk[] = [];
    for await (const remaining of { [Symbol.asyncIterator]: () => generator }) {
      rest.push(remaining);
    }
    expect(rest.map((item) => item.type)).toEqual(['usage', 'done']);
  });
});
