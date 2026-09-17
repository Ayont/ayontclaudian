import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type ClaudianPlugin from '../../../main';
import { decodeOmpModelId } from '../models';
import { OmpAuxQueryRunner } from '../runtime/OmpAuxQueryRunner';
import { ompChatUIConfig } from '../ui/OmpChatUIConfig';

export class OmpTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ClaudianPlugin) {
    super({
      createRunner: () => new OmpAuxQueryRunner(plugin, {
        artifactPurpose: 'title-gen',
      }),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        if (!ompChatUIConfig.ownsModel(titleModel, settings)) {
          return undefined;
        }

        return decodeOmpModelId(titleModel) ?? undefined;
      },
    });
  }
}
