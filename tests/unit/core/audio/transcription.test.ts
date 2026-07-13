import type { ChildProcess } from 'node:child_process';

import {
  parseWhisperOutput,
  type SpawnLike,
  transcribeAudioFile,
} from '@/core/audio/transcription';

describe('parseWhisperOutput', () => {
  it('strips timestamps and collapses whitespace', () => {
    const stdout = [
      '[00:00:00.000 --> 00:00:02.000]  Hallo Welt',
      '[00:00:02.000 --> 00:00:04.000]  das ist ein Test',
      '',
      '  mit  extra  spaces ',
    ].join('\n');
    expect(parseWhisperOutput(stdout)).toBe('Hallo Welt das ist ein Test mit extra spaces');
  });

  it('handles plain text without timestamps', () => {
    expect(parseWhisperOutput('Eine Zeile\nNoch eine')).toBe('Eine Zeile Noch eine');
  });

  it('returns empty for blank output', () => {
    expect(parseWhisperOutput('  \n  ')).toBe('');
  });
});

function createFakeSpawn(stdout: string, code: number, stderr = ''): SpawnLike {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  let capturedArgs: string[] = [];
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
  // Defer "data" + "close" to next tick so listeners attach first.
  process.nextTick(() => {
    handlers.stdoutData?.[0]?.(Buffer.from(stdout, 'utf-8'));
    handlers.stderrData?.[0]?.(Buffer.from(stderr, 'utf-8'));
    handlers.proc_close?.[0]?.(code);
  });
  const factory = ((cmd: string, args: string[]) => {
    capturedArgs = args;
    return fakeProc as unknown as ChildProcess;
  }) as SpawnLike;
  (factory as any)._capturedArgs = capturedArgs;
  return factory;
}

function createSpySpawn(stdout: string, code: number): SpawnLike {
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
  const fn = ((cmd: string, args: string[]) => {
    capturedArgs.push(...args);
    return fakeProc as unknown as ChildProcess;
  }) as SpawnLike;
  (fn as any).capturedArgs = capturedArgs;
  return fn;
}

describe('transcribeAudioFile', () => {
  it('resolves ok with transcribed text on exit code 0', async () => {
    const result = await transcribeAudioFile('/tmp/test.wav', {
      spawnImpl: createFakeSpawn('Hallo from whisper', 0),
    });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hallo from whisper');
  });

  it('resolves ok:false with error on non-zero exit', async () => {
    const result = await transcribeAudioFile('/tmp/test.wav', {
      spawnImpl: createFakeSpawn('', 1, 'model not found'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('model not found');
  });

  it('returns ENOENT hint when whisper-cli is missing', async () => {
    const enoentSpawn = ((): ChildProcess => {
      const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
      const fakeProc = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event: string, cb: (...args: unknown[]) => void) => {
          const key = `proc_${event}`;
          handlers[key] = handlers[key] ?? [];
          handlers[key].push(cb);
        },
      };
      process.nextTick(() => {
        handlers.proc_error?.[0]?.(Object.assign(new Error('spawn whisper-cli ENOENT'), { code: 'ENOENT' }));
      });
      return fakeProc as unknown as ChildProcess;
    }) as SpawnLike;
    const result = await transcribeAudioFile('/tmp/test.wav', {
      spawnImpl: enoentSpawn,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('brew install whisper-cpp');
  });

  it('passes anti-hallucination flags to whisper-cli', async () => {
    const spySpawn = createSpySpawn('Hallo', 0);
    await transcribeAudioFile('/tmp/test.wav', { spawnImpl: spySpawn });
    const args = (spySpawn as any).capturedArgs;
    expect(args).toContain('--no-context');
    expect(args).toContain('--max-len');
    expect(args).toContain('--condition-on-false');
  });
});
