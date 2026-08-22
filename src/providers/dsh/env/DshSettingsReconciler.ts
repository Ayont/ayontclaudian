import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { resolveDshModelSelection } from '../modelOptions';
import { DEFAULT_DSH_MODEL } from '../types/models';

/**
 * dsh has exactly ONE selectable model (the headless profile has no launch-time
 * model surface), so reconciliation only normalizes a stale stored id back to
 * the built-in default. No conversations are invalidated: dsh turns are
 * stateless history replays with nothing resumable to drop.
 */
export const dshSettingsReconciler: ProviderSettingsReconciler = {
  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    _conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const currentModel = typeof settings.model === 'string' ? settings.model : '';
    const nextModel = resolveDshModelSelection(settings, currentModel);

    if (!nextModel || nextModel === currentModel) {
      return { changed: false, invalidatedConversations: [] };
    }

    settings.model = nextModel;
    return { changed: true, invalidatedConversations: [] };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const model = settings.model;
    if (!model || model === DEFAULT_DSH_MODEL) {
      return false;
    }
    settings.model = DEFAULT_DSH_MODEL;
    return true;
  },
};
