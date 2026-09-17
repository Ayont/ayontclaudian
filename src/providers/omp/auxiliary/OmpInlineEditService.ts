import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import type ClaudianPlugin from '../../../main';
import { OmpAuxQueryRunner } from '../runtime/OmpAuxQueryRunner';

export class OmpInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ClaudianPlugin) {
    super(new OmpAuxQueryRunner(plugin, {
      artifactPurpose: 'inline',
      allowReadTextFile: true,
    }));
  }
}
