import { VoiceBackendResolver } from './VoiceBackendResolver';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';

export type { TranscriberOptions, TranscriptionResult, VoiceTranscriber };
export { WhisperCliTranscriber, parseWhisperOutput } from './WhisperCliTranscriber';
export type { TranscriberFactory } from './VoiceBackendResolver';

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

export interface TranscribeOptions extends TranscriberOptions {
  /** If true, prefer the fast backend (mlx_whisper on macOS). */
  preferFastBackend?: boolean;
  /** Optional backend factories for testing or custom backends. */
  backendFactories?: import('./VoiceBackendResolver').TranscriberFactory[];
}

/**
 * Transcribes a wav file using the best available backend.
 * Resolves with `ok: false` and a human-readable error instead of throwing,
 * so the caller can surface a Notice.
 */
export async function transcribeAudioFile(
  wavPath: string,
  options: TranscribeOptions = {},
): Promise<TranscriptionResult> {
  const resolver = new VoiceBackendResolver(
    options.preferFastBackend ?? true,
    process.platform,
    options.backendFactories,
  );
  const backend = await resolver.resolve();
  if (!backend) {
    return {
      ok: false,
      text: '',
      error: 'Kein Transkriptions-Backend verfügbar. Bitte Spracheingabe-Einrichtung ausführen.',
    };
  }
  return backend.transcribe(wavPath, options);
}
