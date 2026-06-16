import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { resolveGrokModelSelection } from '../modelOptions';
import { GROK_PROVIDER_ID } from '../settings';
import { getGrokState } from '../types';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';

/**
 * Grok has env-driven model selection (`GROK_MODEL`), so model reconciliation
 * is real (unlike antigravity's no-op): when the resolved model changes, the
 * active model setting is re-pointed and any Grok conversations bound to the
 * old model are invalidated so they re-resolve on next use.
 */
export const grokSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveGrokModelSelection(settings, currentModel);

    if (!nextModel || nextModel === currentModel) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      const state = getGrokState(conv.providerState);
      if (conv.providerId === GROK_PROVIDER_ID && (conv.sessionId || state.sessionId)) {
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

    const normalizedModel = grokChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },
};
