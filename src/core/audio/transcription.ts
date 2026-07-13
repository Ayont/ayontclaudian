import { spawn } from 'node:child_process';

import { getEnhancedPath } from '../../utils/env';

/**
 * Local speech-to-text via whisper.cpp (`whisper-cli`), the same toolchain the
 * video analyzer already relies on. Audio is captured in the renderer, written
 * to a temp wav, and transcribed here through a spawned CLI — no network, no
 * cloud. Fully local and provider-independent.
 */

export interface TranscriptionResult {
  ok: boolean;
  text: string;
  error?: string;
}

/** Minimal spawn shape so tests can inject a fake without node:child_process. */
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

export interface TranscribeOptions {
  /** Path to the ggml model; defaults to the video-analyzer's base model. */
  modelPath?: string;
  /** BCP-47-ish language hint, or 'auto'. */
  language?: string;
  /** Injectable spawn for tests. */
  spawnImpl?: SpawnLike;
}

/** Maps Claudian UI locales to whisper.cpp language codes. */
const LOCALE_TO_WHISPER: Record<string, string> = {
  de: 'de',
  en: 'en',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  es: 'es',
  ru: 'ru',
  pt: 'pt',
};

/**
 * Resolves the whisper language to use. If the user explicitly chose a language
 * in voice settings, that wins. When set to 'auto', we fall back to the plugin's
 * UI locale so German users get `-l de` instead of relying on whisper's guess.
 */
export function resolveVoiceLanguage(settingsLanguage: string, pluginLocale: string): string {
  if (settingsLanguage && settingsLanguage !== 'auto') return settingsLanguage;
  return LOCALE_TO_WHISPER[pluginLocale] ?? 'auto';
}

/**
 * Transcribes a wav file with `whisper-cli`. Resolves with `ok: false` and a
 * human-readable error instead of throwing, so the caller can surface a Notice.
 */
export function transcribeAudioFile(
  wavPath: string,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const modelPath = expandHome(options.modelPath ?? DEFAULT_MODEL_PATH);
  const language = options.language ?? 'auto';
  const spawnImpl = options.spawnImpl ?? spawn;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = spawnImpl(
        'whisper-cli',
        // -mc 0 disables cross-segment context (prevents "you" hallucinations on silence).
        // -sns suppresses non-speech tokens. We intentionally do NOT pass -ml 1,
        // because that caps each segment to 1 character and destroys sentences.
        ['-m', modelPath, '-l', language, '-nt', '-mc', '0', '-sns', wavPath],
        { env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) }, windowsHide: true },
      );
    } catch (error) {
      resolve({
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
      resolve({
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
        resolve({ ok: true, text });
      } else if (code === 0) {
        resolve({ ok: true, text: '' });
      } else {
        resolve({
          ok: false,
          text: '',
          error: stderr.trim() || `whisper-cli endete mit Code ${code ?? -1}`,
        });
      }
    });
  });
}
