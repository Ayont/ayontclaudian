import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { DshAuxQueryRunner } from '../runtime/DshAuxQueryRunner';

export class DshTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new DshAuxQueryRunner(plugin),
    });
  }
}
