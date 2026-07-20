import { type CloudWhisperConfig,CloudWhisperTranscriber } from './CloudWhisperTranscriber';
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
    private readonly cloudConfig?: CloudWhisperConfig | null,
  ) {}

  async resolve(): Promise<VoiceTranscriber | null> {
    const candidates: VoiceTranscriber[] = [];

    if (this.factories) {
      candidates.push(...this.factories.map((f) => f()));
    } else {
      // Cloud first when configured: sub-second answers, zero installs, and
      // large-v3-turbo accuracy — strictly faster than every local path.
      // whisper-server keeps the model loaded in memory across every
      // recording — no repeated multi-second reload per push-to-talk press.
      // It ships in the same whisper-cpp package as whisper-cli, so it is
      // preferred unconditionally among the local backends (not gated by
      // preferFastBackend, which is specifically the legacy mlx-whisper
      // toggle).
      if (this.cloudConfig?.apiKey) {
        candidates.push(new CloudWhisperTranscriber(this.cloudConfig));
      }
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
