import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { VibeAuxQueryRunner } from '../runtime/VibeAuxQueryRunner';

export class VibeInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new VibeAuxQueryRunner(plugin));
  }
}
