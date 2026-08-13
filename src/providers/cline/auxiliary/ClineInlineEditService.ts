import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { ClineAuxQueryRunner } from '../runtime/ClineAuxQueryRunner';

export class ClineInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new ClineAuxQueryRunner(plugin));
  }
}
