import { MlxWhisperTranscriber } from './MlxWhisperTranscriber';
import { WhisperCliTranscriber } from './WhisperCliTranscriber';
import type { VoiceTranscriber } from './VoiceTranscriber';

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
