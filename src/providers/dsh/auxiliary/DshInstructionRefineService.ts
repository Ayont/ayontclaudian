import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import type ClaudianPlugin from '../../../main';
import { DshAuxQueryRunner } from '../runtime/DshAuxQueryRunner';

export class DshInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ClaudianPlugin) {
    super(new DshAuxQueryRunner(plugin));
  }
}
