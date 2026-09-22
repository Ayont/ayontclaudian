import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { DesktopBridgeProviderId } from './DesktopBridgeTransport';

/** Current Grok desktop app serves grok-4.7 (`context_window` 500_000). */
export const GROK_DESKTOP_CONTEXT_WINDOW = 500_000;
/** Perplexity Sonar Pro published context window. */
export const PERPLEXITY_DESKTOP_CONTEXT_WINDOW = 200_000;
/** Tool-protocol follow-ups stay inside one desktop composer page. */
export const DESKTOP_TOOL_PROMPT_CHAR_CAP = 2_000;

export function desktopContextWindowTokens(
  id: DesktopBridgeProviderId,
  model?: string,
  customLimits?: Record<string, number>,
): number {
  const key = model && model.length > 0 ? model : `desktop:${id}`;
  const custom = customLimits?.[key];
  if (typeof custom === 'number' && Number.isFinite(custom) && custom > 0) return custom;
  return id === 'grok-bot' ? GROK_DESKTOP_CONTEXT_WINDOW : PERPLEXITY_DESKTOP_CONTEXT_WINDOW;
}

/** Character budget for one chat prompt. Same 4 chars/token ratio as the switch carry. */
export function desktopConversationCharCap(
  id: DesktopBridgeProviderId,
  model?: string,
  customLimits?: Record<string, number>,
): number {
  return Math.round(desktopContextWindowTokens(id, model, customLimits) * 4);
}
export const DEFAULT_DESKTOP_SETTINGS = { enabled: false, knowledgeTools: false, knowledgeScope: '', knowledgeMemory: false, knowledgeMemoryFolder: '', desktopMcp: false, contextTools: false, vaultTools: false, vaultRoot: '', localTools: false, commandExecution: false, maxToolActions: 12, toolRoot: '', anchor: '', bindings: {} as Record<string, string> };
export function getDesktopSettings(settings: Record<string, unknown>, id: DesktopBridgeProviderId) {
  const value = getProviderConfig(settings, id);
  return { knowledgeTools: value.knowledgeTools === true, knowledgeScope: typeof value.knowledgeScope === 'string' ? value.knowledgeScope : '', knowledgeMemory: value.knowledgeMemory === true, knowledgeMemoryFolder: typeof value.knowledgeMemoryFolder === 'string' ? value.knowledgeMemoryFolder : '', desktopMcp: value.desktopMcp === true, contextTools: value.contextTools === true, vaultTools: value.vaultTools === true, vaultRoot: typeof value.vaultRoot === 'string' ? value.vaultRoot : '', commandExecution: value.commandExecution === true, maxToolActions: typeof value.maxToolActions === 'number' && Number.isInteger(value.maxToolActions) ? Math.max(1, Math.min(30, value.maxToolActions)) : 12, localTools: value.localTools === true, toolRoot: typeof value.toolRoot === 'string' ? value.toolRoot : '', enabled: value.enabled === true, anchor: typeof value.anchor === 'string' ? value.anchor : '', bindings: Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(Object.entries(value.bindings && typeof value.bindings === 'object' && !Array.isArray(value.bindings) ? value.bindings : {}).filter(([, owner]) => typeof owner === 'string' && owner.length > 0))) };
}
export function updateDesktopSettings(settings: Record<string, unknown>, id: DesktopBridgeProviderId, update: Partial<typeof DEFAULT_DESKTOP_SETTINGS>) {
  setProviderConfig(settings, id, { ...getDesktopSettings(settings, id), ...update });
}
