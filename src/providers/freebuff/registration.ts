import type { ProviderRegistration } from '../../core/providers/types';
import { FreebuffInlineEditService } from './auxiliary/FreebuffInlineEditService';
import { FreebuffInstructionRefineService } from './auxiliary/FreebuffInstructionRefineService';
import { FreebuffTaskResultInterpreter } from './auxiliary/FreebuffTaskResultInterpreter';
import { FreebuffTitleGenerationService } from './auxiliary/FreebuffTitleGenerationService';
import { FREEBUFF_PROVIDER_CAPABILITIES } from './capabilities';
import { freebuffSettingsReconciler } from './env/FreebuffSettingsReconciler';
import { FreebuffConversationHistoryService } from './history/FreebuffConversationHistoryService';
import { FreebuffAuxQueryRunner } from './runtime/FreebuffAuxQueryRunner';
import { FreebuffChatRuntime } from './runtime/FreebuffChatRuntime';
import { getFreebuffProviderSettings } from './settings';
import { freebuffChatUIConfig } from './ui/FreebuffChatUIConfig';

/**
 * Freebuff provider registration.
 *
 * Freebuff is the free coding agent built on the Codebuff platform; turns run
 * inside its desktop app over the loopback orchestrator API. Brand color is a
 * warm buffalo amber, deliberately distinct from the DeepSeek blue next to it
 * in the provider rail.
 */
export const freebuffProviderRegistration: ProviderRegistration = {
  blankTabOrder: 18,
  capabilities: FREEBUFF_PROVIDER_CAPABILITIES,
  chatUIConfig: freebuffChatUIConfig,
  createAuxQueryRunner: (plugin) => new FreebuffAuxQueryRunner(plugin),
  createInlineEditService: (plugin) => new FreebuffInlineEditService(plugin),
  createInstructionRefineService: (plugin) => new FreebuffInstructionRefineService(plugin),
  createRuntime: ({ plugin }) => new FreebuffChatRuntime(plugin),
  createTitleGenerationService: (plugin) => new FreebuffTitleGenerationService(plugin),
  displayName: 'Freebuff',
  environmentKeyPatterns: [/^FREEBUFF_/i],
  historyService: new FreebuffConversationHistoryService(),
  isEnabled: (settings) => getFreebuffProviderSettings(settings).enabled,
  settingsReconciler: freebuffSettingsReconciler,
  taskResultInterpreter: new FreebuffTaskResultInterpreter(),
  brandColor: '#E8A33D',
  brandColorLight: '#FFF3DF',
};
