import type { ProviderRegistration } from '../../core/providers/types';
import { VibeInlineEditService } from './auxiliary/VibeInlineEditService';
import { VibeInstructionRefineService } from './auxiliary/VibeInstructionRefineService';
import { VibeTaskResultInterpreter } from './auxiliary/VibeTaskResultInterpreter';
import { VibeTitleGenerationService } from './auxiliary/VibeTitleGenerationService';
import { VIBE_PROVIDER_CAPABILITIES } from './capabilities';
import { vibeSettingsReconciler } from './env/VibeSettingsReconciler';
import { VibeConversationHistoryService } from './history/VibeConversationHistoryService';
import { VibeChatRuntime } from './runtime/VibeChatRuntime';
import { getVibeProviderSettings } from './settings';
import { vibeChatUIConfig } from './ui/VibeChatUIConfig';

export const vibeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 16,
  capabilities: VIBE_PROVIDER_CAPABILITIES,
  chatUIConfig: vibeChatUIConfig,
  createInlineEditService: (plugin) => new VibeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new VibeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new VibeChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new VibeTitleGenerationService(plugin),
  displayName: 'Vibe',
  environmentKeyPatterns: [/^VIBE_/i, /^MISTRAL_/i],
  historyService: new VibeConversationHistoryService(),
  isEnabled: (settings) => getVibeProviderSettings(settings).enabled,
  settingsReconciler: vibeSettingsReconciler,
  taskResultInterpreter: new VibeTaskResultInterpreter(),
  brandColor: '#7C3AED',
  brandColorLight: '#F3EEFE',
};
