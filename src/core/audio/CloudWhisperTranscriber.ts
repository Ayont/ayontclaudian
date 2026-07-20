import { promises as fs } from 'node:fs';

import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';
import type { FetchLike } from './WhisperServerManager';

/** Groq's OpenAI-compatible endpoint — free tier, whisper-large-v3-turbo. */
export const DEFAULT_CLOUD_BASE_URL = 'https://api.groq.com/openai/v1';
export const DEFAULT_CLOUD_MODEL = 'whisper-large-v3-turbo';

export interface CloudWhisperConfig {
  /** OpenAI-compatible base URL (no trailing slash needed). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Cloud transcription over the OpenAI-compatible `POST /audio/transcriptions`
 * API — works with Groq (default, very fast + free tier), OpenAI
 * (whisper-1, gpt-4o-transcribe) and any compatible proxy.
 *
 * Why this exists: every local backend pays a real cost — model downloads,
 * architecture mismatches (Rosetta), multi-second model loads. A cloud call
 * answers in a fraction of a second even for long clips, needs zero installs,
 * and large-v3-turbo beats ggml-base on accuracy. Audio leaves the machine,
 * so it's opt-in with an explicit API key — local stays the default.
 */
export class CloudWhisperTranscriber implements VoiceTranscriber {
  readonly id = 'cloud-whisper';
  readonly displayName = 'Cloud-Whisper (am schnellsten)';

  constructor(
    private readonly config: CloudWhisperConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /** Cheap check: configured means available. Network errors surface at transcribe time. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.config.apiKey.trim().length > 0);
  }

  async transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`;

    try {
      const buffer = await fs.readFile(wavPath);
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', this.config.model || DEFAULT_CLOUD_MODEL);
      form.append('response_format', 'json');
      const language = options.language || 'auto';
      if (language !== 'auto') {
        form.append('language', language);
      }

      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: abortSignal,
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, text: '', error: 'Cloud-API-Key ungültig — bitte in den Spracheingabe-Einstellungen prüfen.' };
      }
      if (response.status === 429) {
        return { ok: false, text: '', error: 'Cloud-Limit erreicht (429) — kurz warten oder lokales Backend nutzen.' };
      }
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 160);
        return { ok: false, text: '', error: `Cloud-Transkription fehlgeschlagen (HTTP ${response.status})${detail ? `: ${detail}` : ''}` };
      }

      const body = (await response.json()) as { text?: string };
      return { ok: true, text: (body.text ?? '').trim() };
    } catch (error) {
      if (abortSignal?.aborted) {
        return { ok: false, text: '', error: 'Abgebrochen' };
      }
      return {
        ok: false,
        text: '',
        error: error instanceof Error ? error.message : 'Cloud-Anfrage fehlgeschlagen',
      };
    }
  }
}
