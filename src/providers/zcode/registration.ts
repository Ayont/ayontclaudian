import type { ProviderRegistration } from '../../core/providers/types';
import { ZcodeInlineEditService } from './auxiliary/ZcodeInlineEditService';
import { ZcodeInstructionRefineService } from './auxiliary/ZcodeInstructionRefineService';
import { ZcodeTaskResultInterpreter } from './auxiliary/ZcodeTaskResultInterpreter';
import { ZcodeTitleGenerationService } from './auxiliary/ZcodeTitleGenerationService';
import { ZCODE_PROVIDER_CAPABILITIES } from './capabilities';
import { zcodeSettingsReconciler } from './env/ZcodeSettingsReconciler';
import { ZcodeConversationHistoryService } from './history/ZcodeConversationHistoryService';
import { ZcodeAuxQueryRunner } from './runtime/ZcodeAuxQueryRunner';
import { ZcodeChatRuntime } from './runtime/ZcodeChatRuntime';
import { getZcodeProviderSettings } from './settings';
import { zcodeChatUIConfig } from './ui/ZcodeChatUIConfig';

export const zcodeProviderRegistration: ProviderRegistration = {
  blankTabOrder: 19,
  capabilities: ZCODE_PROVIDER_CAPABILITIES,
  chatUIConfig: zcodeChatUIConfig,
  createAuxQueryRunner: (plugin) => new ZcodeAuxQueryRunner(plugin),
  createInlineEditService: (plugin) => new ZcodeInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new ZcodeInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new ZcodeChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new ZcodeTitleGenerationService(plugin),
  displayName: 'ZCode',
  environmentKeyPatterns: [/^ZCODE_/i, /^ZAI_/i, /^GLM_/i],
  historyService: new ZcodeConversationHistoryService(),
  isEnabled: (settings) => getZcodeProviderSettings(settings).enabled,
  settingsReconciler: zcodeSettingsReconciler,
  taskResultInterpreter: new ZcodeTaskResultInterpreter(),
  brandColor: '#2B5BF7',
  brandColorLight: '#EDF2FE',
};
