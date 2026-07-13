export interface TranscriptionResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface TranscriberOptions {
  /** BCP-47-ish language hint, or 'auto'. */
  language: string;
  /** Whisper model size selected by the user (tiny/base/small/medium/large). */
  model: string;
  /** Optional explicit path to a ggml model (whisper-cli only). */
  modelPath?: string;
}

export interface VoiceTranscriber {
  readonly id: string;
  readonly displayName: string;
  isAvailable(): Promise<boolean>;
  transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult>;
}
