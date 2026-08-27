import type { ProviderRegistration } from '../../core/providers/types';
import { ClineInlineEditService } from './auxiliary/ClineInlineEditService';
import { ClineInstructionRefineService } from './auxiliary/ClineInstructionRefineService';
import { ClineTaskResultInterpreter } from './auxiliary/ClineTaskResultInterpreter';
import { ClineTitleGenerationService } from './auxiliary/ClineTitleGenerationService';
import { CLINE_PROVIDER_CAPABILITIES } from './capabilities';
import { clineSettingsReconciler } from './env/ClineSettingsReconciler';
import { ClineConversationHistoryService } from './history/ClineConversationHistoryService';
import { ClineAuxQueryRunner } from './runtime/ClineAuxQueryRunner';
import { ClineChatRuntime } from './runtime/ClineChatRuntime';
import { getClineProviderSettings } from './settings';
import { clineChatUIConfig } from './ui/ClineChatUIConfig';

export const clineProviderRegistration: ProviderRegistration = {
  blankTabOrder: 12,
  capabilities: CLINE_PROVIDER_CAPABILITIES,
  chatUIConfig: clineChatUIConfig,
  createAuxQueryRunner: (plugin) => new ClineAuxQueryRunner(plugin),
  createInlineEditService: (plugin) => new ClineInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new ClineInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new ClineChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new ClineTitleGenerationService(plugin),
  displayName: 'Cline',
  environmentKeyPatterns: [/^CLINE_/i],
  historyService: new ClineConversationHistoryService(),
  isEnabled: (settings) => getClineProviderSettings(settings).enabled,
  settingsReconciler: clineSettingsReconciler,
  taskResultInterpreter: new ClineTaskResultInterpreter(),
  brandColor: '#00C9A7',
  brandColorLight: '#E6FFF9',
};
