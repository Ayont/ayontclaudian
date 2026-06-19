import { syncProviderModelConfig } from '../../../core/providers/modelConfigSync';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { resolveKimiModelSelection } from '../modelOptions';
import { KIMI_PROVIDER_ID } from '../settings';
import { getKimiState } from '../types';
import { kimiChatUIConfig } from '../ui/KimiChatUIConfig';

/**
 * Kimi has env-driven model selection (`KIMI_MODEL`), so model reconciliation
 * is real (unlike antigravity's no-op): when the resolved model changes, the
 * active model setting is re-pointed and any Kimi conversations bound to the
 * old model are invalidated so they re-resolve on next use.
 */
export const kimiSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveKimiModelSelection(settings, currentModel);

    if (!nextModel || nextModel === currentModel) {
      return { changed: false, invalidatedConversations: [] };
    }

    // Ensure the newly selected model is persisted in Kimi's config.toml before
    // any conversation can spawn with it.
    syncProviderModelConfig(KIMI_PROVIDER_ID, nextModel, settings);

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      const state = getKimiState(conv.providerState);
      if (conv.providerId === KIMI_PROVIDER_ID && (conv.sessionId || state.sessionId)) {
        conv.sessionId = null;
        conv.providerState = undefined;
        invalidatedConversations.push(conv);
      }
    }

    settings.model = nextModel;
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model as string;
    if (!model) {
      return false;
    }

    const normalizedModel = kimiChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },
};
