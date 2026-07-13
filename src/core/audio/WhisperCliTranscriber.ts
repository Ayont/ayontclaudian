import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';
import { resolveThreadCount } from './WhisperServerManager';

export type SpawnLike = typeof spawn;

const DEFAULT_MODEL_PATH = '~/.cache/whisper-cpp/ggml-base.bin';

/** Expands a leading `~` to the user's home directory. */
function expandHome(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

/**
 * Parses whisper-cli stdout into clean text. `--no-timestamps` output is plain
 * lines, but be defensive and strip any `[00:00:00.000 --> ...]` prefixes and
 * collapse whitespace so the composer gets a tidy paragraph.
 */
export function parseWhisperOutput(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class WhisperCliTranscriber implements VoiceTranscriber {
  readonly id = 'whisper-cli';
  readonly displayName = 'whisper-cli (kompatibel)';

  constructor(private readonly spawnImpl: SpawnLike = spawn) {}

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = this.spawnImpl('which', ['whisper-cli'], {
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
    const modelPath = expandHome(options.modelPath ?? DEFAULT_MODEL_PATH);
    const language = options.language || 'auto';

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let proc: ReturnType<SpawnLike> | undefined;
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
          'whisper-cli',
          // -mc 0 disables cross-segment context (prevents "you" hallucinations on silence).
          // -sns suppresses non-speech tokens. We intentionally do NOT pass -ml 1,
          // because that caps each segment to 1 character and destroys sentences.
          // -t: whisper-cli's own default is a hardcoded 4 threads regardless of
          // the machine — pass the actual usable core count so decode isn't
          // artificially throttled on 8+ core Macs.
          ['-m', modelPath, '-l', language, '-nt', '-mc', '0', '-sns', '-t', String(resolveThreadCount(cpus().length)), wavPath],
          {
            env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
            windowsHide: true,
          },
        );
      } catch (error) {
        finish({
          ok: false,
          text: '',
          error: error instanceof Error ? error.message : 'whisper-cli konnte nicht gestartet werden',
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
            ? 'whisper-cli nicht gefunden — installiere es mit „brew install whisper-cpp".'
            : error.message,
        });
      });
      proc.on('close', (code: number | null) => {
        const text = parseWhisperOutput(stdout);
        if (code === 0 && text) {
          finish({ ok: true, text });
        } else if (code === 0) {
          finish({ ok: true, text: '' });
        } else {
          finish({
            ok: false,
            text: '',
            error: stderr.trim() || `whisper-cli endete mit Code ${code ?? -1}`,
          });
        }
      });
    });
  }
}
