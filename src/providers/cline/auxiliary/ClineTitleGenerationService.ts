import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { ClineAuxQueryRunner } from '../runtime/ClineAuxQueryRunner';

export class ClineTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new ClineAuxQueryRunner(plugin),
    });
  }
}
