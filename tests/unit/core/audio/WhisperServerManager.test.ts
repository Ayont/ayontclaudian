import type { ChildProcess } from 'node:child_process';
import type { promises as fsPromises } from 'node:fs';

import {
  type FetchLike,
  resolveThreadCount,
  type SpawnLike,
  WhisperServerManager,
} from '@/core/audio/WhisperServerManager';

/** Fake `which whisper-server` spawn — exits immediately with the given code. */
function createWhichSpawn(code: number): SpawnLike {
  return ((_cmd: string, _args: string[]) => {
    const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
    const proc = {
      on: (event: string, cb: (...a: unknown[]) => void) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(cb);
      },
      kill: jest.fn(),
    } as unknown as ChildProcess;
    process.nextTick(() => {
      (handlers.close ?? []).forEach((cb) => cb(code));
    });
    return proc;
  }) as unknown as SpawnLike;
}

/**
 * Fake `whisper-server` spawn: the returned process never exits on its own
 * (simulates a long-running server) and records every invocation's args.
 */
function createServerSpawnSpy(): {
  spawn: SpawnLike;
  calls: { cmd: string; args: string[] }[];
  kills: jest.Mock[];
} {
  const calls: { cmd: string; args: string[] }[] = [];
  const kills: jest.Mock[] = [];
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args: args.map(String) });
    const kill = jest.fn();
    kills.push(kill);
    const proc = {
      on: (_event: string, _cb: (...a: unknown[]) => void) => {
        // No-op: this fake server process never emits 'exit'/'error' on its
        // own — it stays "running" until stop() calls kill(), matching a
        // real long-lived whisper-server process.
      },
      kill,
    } as unknown as ChildProcess;
    return proc;
  }) as unknown as SpawnLike;
  return { spawn, calls, kills };
}

/** Fake `fetch`: health-check route always healthy, `/inference` returns fixed text. */
function createHealthyFetch(text = 'Hallo Welt'): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/inference')) {
      return { ok: true, status: 200, text: async () => text } as Response;
    }
    return { ok: true, status: 200, text: async () => '' } as Response;
  }) as FetchLike;
}

/** Fake `fetch` where every request fails to connect (server never comes up). */
function createUnreachableFetch(): FetchLike {
  return (async () => {
    throw new Error('ECONNREFUSED');
  }) as FetchLike;
}

describe('resolveThreadCount', () => {
  it('floors at 4 for low core counts', () => {
    expect(resolveThreadCount(1)).toBe(4);
    expect(resolveThreadCount(2)).toBe(4);
  });

  it('caps at 8 for high core counts', () => {
    expect(resolveThreadCount(16)).toBe(8);
    expect(resolveThreadCount(24)).toBe(8);
  });

  it('uses the actual core count in between', () => {
    expect(resolveThreadCount(6)).toBe(6);
  });

  it('falls back to 4 for invalid input', () => {
    expect(resolveThreadCount(0)).toBe(4);
    expect(resolveThreadCount(NaN)).toBe(4);
    expect(resolveThreadCount(-1)).toBe(4);
  });
});

describe('WhisperServerManager', () => {
  let readFileSpy: jest.SpiedFunction<typeof fsPromises.readFile>;

  beforeEach(async () => {
    const fs = await import('node:fs');
    readFileSpy = jest.spyOn(fs.promises, 'readFile').mockResolvedValue(Buffer.from('fake-wav'));
  });

  afterEach(() => {
    readFileSpy.mockRestore();
  });

  it('isAvailable resolves true when whisper-server is found on PATH', async () => {
    const manager = new WhisperServerManager(createWhichSpawn(0), createHealthyFetch());
    expect(await manager.isAvailable()).toBe(true);
  });

  it('isAvailable resolves false when whisper-server is missing', async () => {
    const manager = new WhisperServerManager(createWhichSpawn(1), createHealthyFetch());
    expect(await manager.isAvailable()).toBe(false);
  });

  it('starts the server once and reuses it for repeated transcriptions of the same model', async () => {
    const { spawn, calls } = createServerSpawnSpy();
    const manager = new WhisperServerManager(spawn, createHealthyFetch('Erste Aufnahme'));

    const first = await manager.transcribe('/tmp/a.wav', { model: 'base', language: 'de' });
    expect(first.ok).toBe(true);
    expect(first.text).toBe('Erste Aufnahme');

    const second = await manager.transcribe('/tmp/b.wav', { model: 'base', language: 'de' });
    expect(second.ok).toBe(true);

    // Only ONE whisper-server process for two transcriptions of the same
    // model — this is the entire point of the persistent-server design: no
    // repeated multi-second model reload per recording.
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('whisper-server');
    expect(calls[0].args).toContain('-m');
    expect(calls[0].args).toContain('--port');

    manager.stop();
  });

  it('restarts the server when a different model is requested', async () => {
    const { spawn, calls, kills } = createServerSpawnSpy();
    const manager = new WhisperServerManager(spawn, createHealthyFetch());

    await manager.transcribe('/tmp/a.wav', { model: 'base' });
    await manager.transcribe('/tmp/b.wav', { model: 'small' });

    expect(calls).toHaveLength(2);
    expect(calls[0].args.join(' ')).toContain('ggml-base.bin');
    expect(calls[1].args.join(' ')).toContain('ggml-small.bin');
    // The first (now-stale) server process must be torn down before starting
    // the replacement, never left running as an orphan.
    expect(kills[0]).toHaveBeenCalledWith('SIGTERM');

    manager.stop();
  });

  it('sends the requested language on every transcription request', async () => {
    const { spawn } = createServerSpawnSpy();
    const fetchImpl = jest.fn(createHealthyFetch());
    const manager = new WhisperServerManager(spawn, fetchImpl as unknown as FetchLike);

    await manager.transcribe('/tmp/a.wav', { model: 'base', language: 'de' });

    const inferenceCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith('/inference'));
    expect(inferenceCall).toBeDefined();
    const body = inferenceCall![1]?.body as FormData;
    expect(body.get('language')).toBe('de');
    expect(body.get('response_format')).toBe('text');

    manager.stop();
  });

  it('returns ok:false when the server never becomes healthy', async () => {
    const { spawn } = createServerSpawnSpy();
    // Short timeouts + a single candidate port so this test resolves in
    // milliseconds instead of waiting out the real (15s × 3 ports) production
    // budget for an unreachable server.
    const manager = new WhisperServerManager(spawn, createUnreachableFetch(), {
      candidatePorts: [8123],
      healthTimeoutMs: 50,
      healthPollIntervalMs: 10,
    });

    const result = await manager.transcribe('/tmp/a.wav', { model: 'base' });

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('reports ok:false with "Abgebrochen" when the abort signal fires', async () => {
    const { spawn } = createServerSpawnSpy();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/inference')) {
        // Simulate fetch honoring the abort signal by rejecting.
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        throw new DOMException('Aborted', 'AbortError');
      }
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as FetchLike;
    const manager = new WhisperServerManager(spawn, fetchImpl);
    const controller = new AbortController();
    controller.abort();

    const result = await manager.transcribe('/tmp/a.wav', { model: 'base' }, controller.signal);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Abgebrochen');

    manager.stop();
  });

  it('stop() is safe to call repeatedly and when nothing is running', () => {
    const manager = new WhisperServerManager(createServerSpawnSpy().spawn, createHealthyFetch());
    expect(() => manager.stop()).not.toThrow();
    expect(manager.isRunning).toBe(false);
    expect(() => manager.stop()).not.toThrow();
  });
});
