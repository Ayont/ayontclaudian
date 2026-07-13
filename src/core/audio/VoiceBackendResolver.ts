import { MlxWhisperTranscriber } from './MlxWhisperTranscriber';
import type { VoiceTranscriber } from './VoiceTranscriber';
import { WhisperCliTranscriber } from './WhisperCliTranscriber';
import { WhisperServerTranscriber } from './WhisperServerTranscriber';

export type TranscriberFactory = () => VoiceTranscriber;

export class VoiceBackendResolver {
  constructor(
    private readonly preferFastBackend: boolean,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly factories?: TranscriberFactory[],
  ) {}

  async resolve(): Promise<VoiceTranscriber | null> {
    const candidates: VoiceTranscriber[] = [];

    if (this.factories) {
      candidates.push(...this.factories.map((f) => f()));
    } else {
      // whisper-server keeps the model loaded in memory across every
      // recording — no repeated multi-second reload per push-to-talk press.
      // It ships in the same whisper-cpp package as whisper-cli, so it is
      // preferred unconditionally (not gated by preferFastBackend, which is
      // specifically the legacy mlx-whisper toggle).
      candidates.push(new WhisperServerTranscriber());
      if (this.preferFastBackend && this.platform === 'darwin') {
        candidates.push(new MlxWhisperTranscriber());
      }
      candidates.push(new WhisperCliTranscriber());
    }

    for (const candidate of candidates) {
      if (await candidate.isAvailable()) {
        return candidate;
      }
    }

    return null;
  }
}
