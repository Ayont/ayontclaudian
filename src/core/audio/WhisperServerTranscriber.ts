import type { TranscriberOptions, TranscriptionResult, VoiceTranscriber } from './VoiceTranscriber';
import { type WhisperServerManager,whisperServerManager } from './WhisperServerManager';

/**
 * `VoiceTranscriber` adapter over the shared {@link WhisperServerManager}
 * singleton. Kept as a thin wrapper so the resolver can treat it exactly like
 * the other backends, while the actual warm-process state lives in the
 * manager (shared across every instance, every tab, the whole session).
 */
export class WhisperServerTranscriber implements VoiceTranscriber {
  readonly id = 'whisper-server';
  readonly displayName = 'whisper-server (schnell, bleibt geladen)';

  constructor(private readonly manager: WhisperServerManager = whisperServerManager) {}

  isAvailable(): Promise<boolean> {
    return this.manager.isAvailable();
  }

  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    return this.manager.transcribe(wavPath, options, abortSignal);
  }
}
