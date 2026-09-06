import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { ZcodeAuxQueryRunner } from '../runtime/ZcodeAuxQueryRunner';

export class ZcodeTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new ZcodeAuxQueryRunner(plugin),
    });
  }
}
