import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { GrokAuxQueryRunner } from '../runtime/GrokAuxQueryRunner';

export class GrokTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new GrokAuxQueryRunner(plugin),
    });
  }
}
