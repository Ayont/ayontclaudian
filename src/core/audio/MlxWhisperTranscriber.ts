import { spawn } from 'node:child_process';

import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';
import type { SpawnLike } from './WhisperCliTranscriber';

/** Maps the user-facing model size to the MLX Hugging Face model identifier. */
const MLX_MODEL_MAP: Record<string, string> = {
  tiny: 'mlx-community/whisper-tiny-mlx',
  base: 'mlx-community/whisper-base-mlx',
  small: 'mlx-community/whisper-small-mlx',
  medium: 'mlx-community/whisper-medium-mlx',
  large: 'mlx-community/whisper-large-v3-mlx',
};

export class MlxWhisperTranscriber implements VoiceTranscriber {
  readonly id = 'mlx-whisper';
  readonly displayName = 'mlx-whisper (schnell, macOS)';

  constructor(private readonly spawnImpl: SpawnLike = spawn) {}

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = this.spawnImpl('python3', ['-m', 'mlx_whisper', '--help'], {
          env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
          windowsHide: true,
        });
      } catch {
        resolve(false);
        return;
      }
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const model = MLX_MODEL_MAP[options.model] ?? MLX_MODEL_MAP.base;
    const language = options.language || 'auto';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let proc: ReturnType<typeof spawn> | undefined;
      let settled = false;

      const finish = (result: TranscriptionResult) => {
        if (settled) return;
        settled = true;
        abortSignal?.removeEventListener('abort', cleanup);
        resolve(result);
      };

      const cleanup = () => {
        try {
          proc?.kill('SIGTERM');
        } catch {
          // ignore
        }
        finish({ ok: false, text: '', error: 'Abgebrochen' });
      };

      abortSignal?.addEventListener('abort', cleanup, { once: true });

      try {
        proc = this.spawnImpl(
          'python3',
          ['-m', 'mlx_whisper', wavPath, '--model', model, '--language', language],
          {
            env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
            windowsHide: true,
          },
        );
      } catch (error) {
        finish({
          ok: false,
          text: '',
          error: error instanceof Error ? error.message : 'mlx_whisper konnte nicht gestartet werden',
        });
        return;
      }

      proc.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      proc.on('error', (error: Error) => {
        finish({
          ok: false,
          text: '',
          error: /ENOENT/.test(error.message)
            ? 'mlx_whisper nicht gefunden.'
            : error.message,
        });
      });
      proc.on('close', (code: number | null) => {
        const text = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (code === 0) {
          finish({ ok: true, text });
        } else {
          finish({
            ok: false,
            text: '',
            error: stderr.trim() || `mlx_whisper endete mit Code ${code ?? -1}`,
          });
        }
      });
    });
  }
}
