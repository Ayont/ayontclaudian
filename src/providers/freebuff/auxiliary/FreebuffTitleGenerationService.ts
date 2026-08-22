import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { FreebuffAuxQueryRunner } from '../runtime/FreebuffAuxQueryRunner';

export class FreebuffTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({ createRunner: () => new FreebuffAuxQueryRunner(plugin) });
  }
}