import type { ChildProcess } from 'node:child_process';

import { MlxWhisperTranscriber } from '@/core/audio/MlxWhisperTranscriber';
import type { SpawnLike } from '@/core/audio/WhisperCliTranscriber';

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
  }) as unknown as SpawnLike;
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
  }) as unknown as SpawnLike;
  const close = () => {
    handlers.stdoutData?.[0]?.(Buffer.from(stdout, 'utf-8'));
    handlers.proc_close?.[0]?.(code);
  };
  return { spawn, close };
}

function createSpySpawn(stdout: string, code: number): { spawn: SpawnLike; capturedArgs: string[]; capturedCmd: string } {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const capturedArgs: string[] = [];
  let capturedCmd = '';
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
    capturedCmd = cmd;
    capturedArgs.push(...args);
    return fakeProc as unknown as ChildProcess;
  }) as unknown as SpawnLike;
  return { spawn, capturedArgs, capturedCmd };
}

describe('MlxWhisperTranscriber', () => {
  it('isAvailable returns true when mlx_whisper responds', async () => {
    const transcriber = new MlxWhisperTranscriber(createFakeSpawn('help', 0));
    expect(await transcriber.isAvailable()).toBe(true);
  });

  it('isAvailable returns false when mlx_whisper is missing', async () => {
    const transcriber = new MlxWhisperTranscriber(createFakeSpawn('', 1));
    expect(await transcriber.isAvailable()).toBe(false);
  });

  it('transcribe maps base model to mlx-community identifier', async () => {
    const { spawn, capturedArgs } = createSpySpawn('Hallo', 0);
    const transcriber = new MlxWhisperTranscriber(spawn);
    const result = await transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'base' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('mlx-community/whisper-base-mlx');
    expect(capturedArgs).toContain('--language');
    expect(capturedArgs).toContain('de');
  });

  it('transcribe maps large model to mlx-community identifier', async () => {
    const { spawn, capturedArgs } = createSpySpawn('Hallo', 0);
    const transcriber = new MlxWhisperTranscriber(spawn);
    await transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'large' });
    expect(capturedArgs).toContain('mlx-community/whisper-large-v3-mlx');
  });

  it('aborts when signal is triggered', async () => {
    const { spawn } = createDelayedSpawn('Hallo', 0);
    const transcriber = new MlxWhisperTranscriber(spawn);
    const controller = new AbortController();
    const promise = transcriber.transcribe('/tmp/test.wav', { language: 'de', model: 'base' }, controller.signal);
    controller.abort();
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Abgebrochen');
  });
});
