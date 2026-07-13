import { VoiceBackendResolver } from './VoiceBackendResolver';
import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';

export type { TranscriberOptions, TranscriptionResult, VoiceTranscriber };
export { WhisperCliTranscriber, parseWhisperOutput } from './WhisperCliTranscriber';

export interface TranscribeOptions extends TranscriberOptions {
  /** If true, prefer the fast backend (mlx_whisper on macOS). */
  preferFastBackend?: boolean;
  /** Injectable spawn for tests. */
  spawnImpl?: import('./WhisperCliTranscriber').SpawnLike;
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
  const resolver = new VoiceBackendResolver(options.preferFastBackend ?? true);
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
