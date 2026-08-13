import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { ClineAuxQueryRunner } from '../runtime/ClineAuxQueryRunner';

export class ClineInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new ClineAuxQueryRunner(plugin));
  }
}
