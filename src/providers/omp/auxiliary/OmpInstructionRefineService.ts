import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { OmpAuxQueryRunner } from '../runtime/OmpAuxQueryRunner';

export class OmpInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new OmpAuxQueryRunner(plugin, {
      artifactPurpose: 'instructions',
    }));
  }
}
