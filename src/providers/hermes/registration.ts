import type { ProviderRegistration } from '../../core/providers/types';
import { HermesInlineEditService } from './auxiliary/HermesInlineEditService';
import { HermesInstructionRefineService } from './auxiliary/HermesInstructionRefineService';
import { HermesTaskResultInterpreter } from './auxiliary/HermesTaskResultInterpreter';
import { HermesTitleGenerationService } from './auxiliary/HermesTitleGenerationService';
import { HERMES_PROVIDER_CAPABILITIES } from './capabilities';
import { hermesSettingsReconciler } from './env/HermesSettingsReconciler';
import { HermesConversationHistoryService } from './history/HermesConversationHistoryService';
import { HermesChatRuntime } from './runtime/HermesChatRuntime';
import { DEFAULT_HERMES_PROVIDER_SETTINGS, getHermesProviderSettings } from './settings';
import { hermesChatUIConfig } from './ui/HermesChatUIConfig';

export const hermesProviderRegistration: ProviderRegistration = {
  blankTabOrder: 120,
  // Nous Research purple, legible on both themes.
  brandColor: '#8B5CF6',
  brandColorLight: '#F5F3FF',
  capabilities: HERMES_PROVIDER_CAPABILITIES,
  chatUIConfig: hermesChatUIConfig,
  createInlineEditService: (plugin) => new HermesInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new HermesInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new HermesChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new HermesTitleGenerationService(plugin),
  defaultConfig: { ...DEFAULT_HERMES_PROVIDER_SETTINGS },
  displayName: 'Hermes',
  environmentKeyPatterns: [/^HERMES_/i],
  historyService: new HermesConversationHistoryService(),
  isEnabled: (settings) => getHermesProviderSettings(settings).enabled,
  settingsReconciler: hermesSettingsReconciler,
  taskResultInterpreter: new HermesTaskResultInterpreter(),
};
