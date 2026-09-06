import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { ZcodeAuxQueryRunner } from '../runtime/ZcodeAuxQueryRunner';

export class ZcodeInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new ZcodeAuxQueryRunner(plugin));
  }
}
