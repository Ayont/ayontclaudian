import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseConfiguredCustomModelIds } from '../modelOptions';
import { FREEBUFF_PROVIDER_ID, getFreebuffProviderSettings } from '../settings';
import { DEFAULT_FREEBUFF_MODEL, isKnownFreebuffModel } from '../types/models';

function isAllowedFreebuffModel(model: string, customModels: string): boolean {
  return isKnownFreebuffModel(model) || parseConfiguredCustomModelIds(customModels).includes(model);
}

/**
 * Reconciler for the Freebuff provider: normalizes unknown model ids back to
 * the verified catalog default. Conversations are NOT invalidated — an old
 * thread keeps its own harness model inside the desktop app regardless of
 * what the plugin's picker stores next.
 */
export const freebuffSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    _conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const current = getFreebuffProviderSettings(settings);
    if (isAllowedFreebuffModel(current.model, current.customModels)) {
      return { changed: false, invalidatedConversations: [] };
    }
    const config = (settings.providerConfigs as Record<string, unknown> | undefined)?.[FREEBUFF_PROVIDER_ID] as
      | Record<string, unknown>
      | undefined;
    if (config) {
      config.model = DEFAULT_FREEBUFF_MODEL;
    }
    settings.model = DEFAULT_FREEBUFF_MODEL;
    return { changed: true, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const current = getFreebuffProviderSettings(settings);
    if (isAllowedFreebuffModel(current.model, current.customModels)) {
      return false;
    }
    const config = (settings.providerConfigs as Record<string, unknown> | undefined)?.[FREEBUFF_PROVIDER_ID] as
      | Record<string, unknown>
      | undefined;
    if (config) {
      config.model = DEFAULT_FREEBUFF_MODEL;
      return true;
    }
    return false;
  },
};