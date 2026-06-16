import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { VibeAuxQueryRunner } from '../runtime/VibeAuxQueryRunner';

export class VibeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new VibeAuxQueryRunner(plugin));
  }
}
