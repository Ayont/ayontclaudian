import type { ProviderRegistration } from '../../core/providers/types';
import { DshInlineEditService } from './auxiliary/DshInlineEditService';
import { DshInstructionRefineService } from './auxiliary/DshInstructionRefineService';
import { DshTaskResultInterpreter } from './auxiliary/DshTaskResultInterpreter';
import { DshTitleGenerationService } from './auxiliary/DshTitleGenerationService';
import { DSH_PROVIDER_CAPABILITIES } from './capabilities';
import { dshSettingsReconciler } from './env/DshSettingsReconciler';
import { DshConversationHistoryService } from './history/DshConversationHistoryService';
import { DshAuxQueryRunner } from './runtime/DshAuxQueryRunner';
import { DshChatRuntime } from './runtime/DshChatRuntime';
import { getDshProviderSettings } from './settings';
import { dshChatUIConfig } from './ui/DshChatUIConfig';

/**
 * DeepSeek Harness (`dsh`) provider registration.
 *
 * Brand colors follow the DeepSeek identity (deep blue #4D6BFE on white).
 */
export const dshProviderRegistration: ProviderRegistration = {
  blankTabOrder: 17,
  capabilities: DSH_PROVIDER_CAPABILITIES,
  chatUIConfig: dshChatUIConfig,
  createAuxQueryRunner: (plugin) => new DshAuxQueryRunner(plugin),
  createInlineEditService: (plugin) => new DshInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new DshInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new DshChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new DshTitleGenerationService(plugin),
  displayName: 'DeepSeek Harness',
  environmentKeyPatterns: [/^DSH_/i, /^DEEPSEEK_/i],
  historyService: new DshConversationHistoryService(),
  isEnabled: (settings) => getDshProviderSettings(settings).enabled,
  settingsReconciler: dshSettingsReconciler,
  taskResultInterpreter: new DshTaskResultInterpreter(),
  brandColor: '#4D6BFE',
  brandColorLight: '#E8EFFF',
};
