import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';

import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';
import { parseWhisperOutput, type SpawnLike } from './WhisperCliTranscriber';

/** Maps the user-facing model size to the MLX Hugging Face model identifier. */
const MLX_MODEL_MAP: Record<string, string> = {
  tiny: 'mlx-community/whisper-tiny-mlx',
  base: 'mlx-community/whisper-base-mlx',
  small: 'mlx-community/whisper-small-mlx',
  medium: 'mlx-community/whisper-medium-mlx',
  large: 'mlx-community/whisper-large-v3-mlx',
};

/**
 * Dedicated venv that the auto-setup installs mlx-whisper into. Homebrew's
 * Python is PEP 668 externally-managed — a plain `pip install` into it fails
 * outright, which was the original "Spracheingabe kann nicht installiert
 * werden" bug. The venv sidesteps that entirely AND pins a native arm64
 * interpreter on Apple Silicon.
 */
export const VOICE_VENV_DIR = `${homedir()}/.cache/claudian/voice-venv`;
export const VOICE_VENV_WHISPER = `${VOICE_VENV_DIR}/bin/mlx_whisper`;

interface MlxCommand {
  cmd: string;
  prefix: string[];
}

/**
 * mlx-whisper ≥ 0.4 dropped `python -m mlx_whisper` (no `__main__` anymore) —
 * the CLI is the `mlx_whisper` console script now, with dashed flags
 * (--output-dir, not --output_dir). Resolution order: the setup venv's script,
 * a script on PATH, the legacy module invocation last.
 */
export class MlxWhisperTranscriber implements VoiceTranscriber {
  readonly id = 'mlx-whisper';
  readonly displayName = 'mlx-whisper (schnell, macOS)';

  constructor(
    private readonly spawnImpl: SpawnLike = spawn,
    private readonly existsImpl: (p: string) => boolean = existsSync,
  ) {}

  private probe(cmd: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = this.spawnImpl(cmd, args, {
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

  private async resolveCommand(): Promise<MlxCommand | null> {
    if (this.existsImpl(VOICE_VENV_WHISPER)) {
      return { cmd: VOICE_VENV_WHISPER, prefix: [] };
    }
    if (await this.probe('mlx_whisper', ['--help'])) {
      return { cmd: 'mlx_whisper', prefix: [] };
    }
    if (await this.probe('python3', ['-m', 'mlx_whisper', '--help'])) {
      return { cmd: 'python3', prefix: ['-m', 'mlx_whisper'] };
    }
    return null;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.resolveCommand()) !== null;
  }

  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const model = MLX_MODEL_MAP[options.model ?? 'base'] ?? MLX_MODEL_MAP.base;
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

      void this.resolveCommand().then((command) => {
        if (!command) {
          finish({ ok: false, text: '', error: 'mlx_whisper nicht gefunden.' });
          return;
        }

        try {
          proc = this.spawnImpl(
            command.cmd,
            [
              ...command.prefix,
              wavPath,
              '--model', model,
              '--language', language,
              // mlx_whisper's CLI writes txt/vtt/srt/tsv/json files to the
              // current working directory by default — without these flags
              // that would silently dump stray files into the vault (the
              // Obsidian process's cwd) on every single recording.
              '--output-dir', tmpdir(),
              '--output-format', 'txt',
              // Quiet: with the default verbose=True mlx_whisper prints an
              // "Args: {...}" echo to STDOUT, which would leak straight into
              // the composer text.
              '--verbose', 'False',
            ],
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
          // mlx_whisper's CLI prints one `[00:00.000 --> 00:04.000]  text` line
          // per segment by default — reuse the same stripping logic as
          // whisper-cli so timestamps never leak into the composer text.
          const text = parseWhisperOutput(stdout);
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
    });
  }
}
