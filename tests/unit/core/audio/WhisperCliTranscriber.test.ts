import type { ChildProcess } from 'node:child_process';

import { WhisperCliTranscriber, type SpawnLike } from '@/core/audio/WhisperCliTranscriber';

function createFakeSpawn(stdout: string, code: number, stderr = ''): SpawnLike {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const factory = ((cmd: string, args: string[]) => {
    const fakeProc = {
      stdout: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'data') handlers.stdoutData = [cb];
        },
      },
      stderr: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'data') handlers.stderrData = [cb];
        },
      },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        const key = `proc_${event}`;
        handlers[key] = handlers[key] ?? [];
        handlers[key].push(cb);
      },
    };
    process.nextTick(() => {
      handlers.stdoutData?.[0]?.(Buffer.from(stdout, 'utf-8'));
      handlers.stderrData?.[0]?.(Buffer.from(stderr, 'utf-8'));
      handlers.proc_close?.[0]?.(code);
    });
    return fakeProc as unknown as ChildProcess;
  }) as SpawnLike;
  return factory;
}

function createDelayedSpawn(stdout: string, code: number): { spawn: SpawnLike; close: () => void } {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const spawn = ((cmd: string, args: string[]) => {
    const fakeProc = {
      stdout: {
        on: (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'data') handlers.stdoutData = [cb];
        },
      },
      stderr: { on: () => {} },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        const key = `proc_${event}`;
        handlers[key] = handlers[key] ?? [];
        handlers[key].push(cb);
      },
    };
    return fakeProc as unknown as ChildProcess;
  }) as SpawnLike;
  const close = () => {
    handlers.stdoutData?.[0]?.(Buffer.from(stdout, 'utf-8'));
    handlers.proc_close?.[0]?.(code);
  };
  return { spawn, close };
}

function createSpySpawn(stdout: string, code: number): { spawn: SpawnLike; capturedArgs: string[] } {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const capturedArgs: string[] = [];
  const fakeProc = {
    stdout: { on: (event: string, cb: (...args: unknown[]) => void) => { if (event === 'data') handlers.stdoutData = [cb]; } },
    stderr: { on: () => {} },
    on: (event: string, cb: (...args: unknown[]) => void) => {
      const key = `proc_${event}`;
      handlers[key] = handlers[key] ?? [];
      handlers[key].push(cb);
    },
  };
  process.nextTick(() => {
    handlers.stdoutData?.[0]?.(Buffer.from(stdout, 'utf-8'));
    handlers.proc_close?.[0]?.(code);
  });
  const spawn = ((cmd: string, args: string[]) => {
    capturedArgs.push(...args);
    return fakeProc as unknown as ChildProcess;
  }) as SpawnLike;
  return { spawn, capturedArgs };
}

describe('WhisperCliTranscriber', () => {
  it('isAvailable returns true when whisper-cli is found', async () => {
    const transcriber = new WhisperCliTranscriber(createFakeSpawn('/opt/homebrew/bin/whisper-cli\n', 0));
    expect(await transcriber.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when whisper-cli is missing', async () => {
    const transcriber = new WhisperCliTranscriber(createFakeSpawn('', 1));
    expect(await transcriber.isAvailable()).toBe(false);
  });

  it('transcribe passes correct args and returns text', async () => {
    const { spawn, capturedArgs } = createSpySpawn('Hallo Welt', 0);
    const transcriber = new WhisperCliTranscriber(spawn);
    const result = await transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'base' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo Welt');
    expect(capturedArgs).toContain('-m');
    expect(capturedArgs).toContain('-l');
    expect(capturedArgs).toContain('de');
  });

  it('does not pass -ml flag', async () => {
    const { spawn, capturedArgs } = createSpySpawn('Hallo', 0);
    const transcriber = new WhisperCliTranscriber(spawn);
    await transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'base' });
    expect(capturedArgs).not.toContain('-ml');
  });

  it('aborts when signal is triggered', async () => {
    const { spawn } = createDelayedSpawn('Hallo', 0);
    const transcriber = new WhisperCliTranscriber(spawn);
    const controller = new AbortController();
    const promise = transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'base' }, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Abgebrochen');
  });
});
