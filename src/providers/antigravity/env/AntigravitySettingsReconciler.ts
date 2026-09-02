import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { antigravityChatUIConfig } from '../ui/AntigravityChatUIConfig';

/**
 * Antigravity has no env-driven model variants, so environment reconciliation is
 * a no-op. Model normalization is NOT: agy retires Gemini Flash generations
 * (3.5 is gone on agy 1.1.24) and rejects a retired `--model` with status ERROR,
 * so a value persisted by an older build must be migrated on load. The mapping
 * itself lives in the chat UI config (`normalizeModelVariant`), which the picker
 * and the tab draft path also use.
 */
export const antigravitySettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    _settings: Record<string, unknown>,
    _conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    return { changed: false, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model;
    if (typeof model !== 'string' || !model) {
      return false;
    }
    const normalized = antigravityChatUIConfig.normalizeModelVariant(model, settings);
    if (normalized === model) {
      return false;
    }
    settings.model = normalized;
    return true;
  },
};
