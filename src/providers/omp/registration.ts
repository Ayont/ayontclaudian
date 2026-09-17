import type { ProviderRegistration } from '../../core/providers/types';
import { OmpInlineEditService } from './auxiliary/OmpInlineEditService';
import { OmpInstructionRefineService } from './auxiliary/OmpInstructionRefineService';
import { OmpTaskResultInterpreter } from './auxiliary/OmpTaskResultInterpreter';
import { OmpTitleGenerationService } from './auxiliary/OmpTitleGenerationService';
import { OMP_PROVIDER_CAPABILITIES } from './capabilities';
import { ompSettingsReconciler } from './env/OmpSettingsReconciler';
import { OmpConversationHistoryService } from './history/OmpConversationHistoryService';
import { OmpAuxQueryRunner } from './runtime/OmpAuxQueryRunner';
import { OmpChatRuntime } from './runtime/OmpChatRuntime';
import { getOmpProviderSettings } from './settings';
import { ompChatUIConfig } from './ui/OmpChatUIConfig';

export const ompProviderRegistration: ProviderRegistration = {
  blankTabOrder: 10,
  capabilities: OMP_PROVIDER_CAPABILITIES,
  chatUIConfig: ompChatUIConfig,
  createAuxQueryRunner: (plugin) => new OmpAuxQueryRunner(plugin, {
    artifactPurpose: 'instructions',
  }),
  createInlineEditService: (plugin) => new OmpInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new OmpInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new OmpChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new OmpTitleGenerationService(plugin),
  displayName: 'OMP',
  environmentKeyPatterns: [/^OMP_/i],
  historyService: new OmpConversationHistoryService(),
  isEnabled: (settings) => getOmpProviderSettings(settings).enabled,
  settingsReconciler: ompSettingsReconciler,
  taskResultInterpreter: new OmpTaskResultInterpreter(),
  brandColor: '#F97316',
  brandColorLight: '#FFF7ED',
};
