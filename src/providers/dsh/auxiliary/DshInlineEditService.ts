import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { DshAuxQueryRunner } from '../runtime/DshAuxQueryRunner';

export class DshInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new DshAuxQueryRunner(plugin));
  }
}
