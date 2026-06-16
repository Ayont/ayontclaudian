import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { VibeAuxQueryRunner } from '../runtime/VibeAuxQueryRunner';

export class VibeTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new VibeAuxQueryRunner(plugin),
    });
  }
}
