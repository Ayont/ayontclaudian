import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { ZcodeAuxQueryRunner } from '../runtime/ZcodeAuxQueryRunner';

export class ZcodeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new ZcodeAuxQueryRunner(plugin));
  }
}
