import type { ProviderRegistration } from '../../core/providers/types';
import { KimiInlineEditService } from './auxiliary/KimiInlineEditService';
import { KimiInstructionRefineService } from './auxiliary/KimiInstructionRefineService';
import { KimiTaskResultInterpreter } from './auxiliary/KimiTaskResultInterpreter';
import { KimiTitleGenerationService } from './auxiliary/KimiTitleGenerationService';
import { KIMI_PROVIDER_CAPABILITIES } from './capabilities';
import { kimiSettingsReconciler } from './env/KimiSettingsReconciler';
import { KimiConversationHistoryService } from './history/KimiConversationHistoryService';
import { KimiAcpChatRuntime } from './runtime/KimiAcpChatRuntime';
import { KimiChatRuntime } from './runtime/KimiChatRuntime';
import { getKimiProviderSettings } from './settings';
import { kimiChatUIConfig } from './ui/KimiChatUIConfig';

export const kimiProviderRegistration: ProviderRegistration = {
  blankTabOrder: 16,
  capabilities: KIMI_PROVIDER_CAPABILITIES,
  chatUIConfig: kimiChatUIConfig,
  createInlineEditService: (plugin) => new KimiInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new KimiInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => {
    const settings = getKimiProviderSettings(plugin.settings as unknown as Record<string, unknown>);
    return settings.useAcp ? new KimiAcpChatRuntime(plugin) : new KimiChatRuntime(plugin);
  },
  createTitleGenerationService: (plugin) => new KimiTitleGenerationService(plugin),
  displayName: 'Kimi',
  environmentKeyPatterns: [/^KIMI_/i, /^MOONSHOT_/i],
  historyService: new KimiConversationHistoryService(),
  isEnabled: (settings) => getKimiProviderSettings(settings).enabled,
  settingsReconciler: kimiSettingsReconciler,
  taskResultInterpreter: new KimiTaskResultInterpreter(),
};
