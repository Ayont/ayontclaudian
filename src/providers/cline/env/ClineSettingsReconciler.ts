import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { resolveClineModelSelection } from '../modelOptions';
import { CLINE_PROVIDER_ID } from '../settings';
import { getClineState } from '../types';
import { clineChatUIConfig } from '../ui/ClineChatUIConfig';

export const clineSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveClineModelSelection(settings, currentModel);

    if (!nextModel || nextModel === currentModel) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conv of conversations) {
      const state = getClineState(conv.providerState);
      if (conv.providerId === CLINE_PROVIDER_ID && (conv.sessionId || state.sessionId)) {
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

    const normalizedModel = clineChatUIConfig.normalizeModelVariant(model, settings);
    if (normalizedModel === model) {
      return false;
    }

    settings.model = normalizedModel;
    return true;
  },
};
