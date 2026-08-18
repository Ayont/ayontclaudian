import type { CloudWhisperConfig } from './CloudWhisperTranscriber';
import { DEFAULT_CLOUD_BASE_URL, DEFAULT_CLOUD_MODEL } from './CloudWhisperTranscriber';

export const GROQ_WHISPER_BASE_URL = DEFAULT_CLOUD_BASE_URL;
export const GROQ_WHISPER_MODEL = DEFAULT_CLOUD_MODEL;
export const MISTRAL_AUDIO_BASE_URL = 'https://api.mistral.ai/v1';
export const MISTRAL_VOXTRAL_MODEL = 'voxtral-mini-latest';

export interface VoiceCloudSettingsInput {
  cloudEnabled?: boolean;
  cloudApiKey?: string;
  cloudBaseUrl?: string;
  cloudModel?: string;
  env?: Record<string, string | undefined>;
}

function firstKey(env: Record<string, string | undefined> | undefined, names: string[]): string {
  if (!env) return '';
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return '';
}

/**
 * Picks the fastest available cloud STT endpoint.
 *
 * 1. Explicit Spracheingabe-Key (Groq/OpenAI-compatible, or whatever URL the user set)
 * 2. `GROQ_API_KEY` — free turbo Whisper, sub-second
 * 3. `MISTRAL_API_KEY` — Voxtral via the same key Vibe already uses
 *
 * The settings toggle is not required: a key in env is enough, so voice
 * becomes fast the moment Groq or Vibe is configured.
 */
export function resolveVoiceCloudConfig(input: VoiceCloudSettingsInput = {}): CloudWhisperConfig | null {
  const env = input.env ?? {};
  const settingsKey = input.cloudApiKey?.trim() ?? '';
  if (settingsKey) {
    return {
      baseUrl: input.cloudBaseUrl?.trim() || GROQ_WHISPER_BASE_URL,
      apiKey: settingsKey,
      model: input.cloudModel?.trim() || GROQ_WHISPER_MODEL,
    };
  }

  const groqKey = firstKey(env, ['GROQ_API_KEY']);
  if (groqKey) {
    return {
      baseUrl: GROQ_WHISPER_BASE_URL,
      apiKey: groqKey,
      model: GROQ_WHISPER_MODEL,
    };
  }

  const mistralKey = firstKey(env, ['MISTRAL_API_KEY']);
  if (mistralKey) {
    return {
      baseUrl: MISTRAL_AUDIO_BASE_URL,
      apiKey: mistralKey,
      model: MISTRAL_VOXTRAL_MODEL,
    };
  }

  return null;
}
