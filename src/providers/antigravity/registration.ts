import type { ProviderRegistration } from '../../core/providers/types';
import { AntigravityInlineEditService } from './auxiliary/AntigravityInlineEditService';
import { AntigravityInstructionRefineService } from './auxiliary/AntigravityInstructionRefineService';
import { AntigravityTaskResultInterpreter } from './auxiliary/AntigravityTaskResultInterpreter';
import { AntigravityTitleGenerationService } from './auxiliary/AntigravityTitleGenerationService';
import { ANTIGRAVITY_PROVIDER_CAPABILITIES } from './capabilities';
import { antigravitySettingsReconciler } from './env/AntigravitySettingsReconciler';
import { AntigravityConversationHistoryService } from './history/AntigravityConversationHistoryService';
import { AntigravityChatRuntime } from './runtime/AntigravityChatRuntime';
import { getAntigravityProviderSettings } from './settings';
import { antigravityChatUIConfig } from './ui/AntigravityChatUIConfig';

export const antigravityProviderRegistration: ProviderRegistration = {
  blankTabOrder: 12,
  capabilities: ANTIGRAVITY_PROVIDER_CAPABILITIES,
  chatUIConfig: antigravityChatUIConfig,
  createInlineEditService: (plugin) => new AntigravityInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new AntigravityInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new AntigravityChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new AntigravityTitleGenerationService(plugin),
  displayName: 'Antigravity',
  environmentKeyPatterns: [/^ANTIGRAVITY_/i, /^GEMINI_/i],
  historyService: new AntigravityConversationHistoryService(),
  isEnabled: (settings) => getAntigravityProviderSettings(settings).enabled,
  settingsReconciler: antigravitySettingsReconciler,
  taskResultInterpreter: new AntigravityTaskResultInterpreter(),
  brandColor: '#4285F4',
  brandColorLight: '#E8F0FE',
};
