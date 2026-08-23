import { getProviderConfig } from '../../../core/providers/providerConfig';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { clearHermesDiscoveryState } from '../discoveryState';
import { sameStringList } from '../internal/compareCollections';
import {
  decodeHermesModelId,
  encodeHermesModelId,
  isHermesModelSelectionId,
} from '../models';
import { normalizeHermesSelectedMode } from '../modes';
import {
  getHermesProviderSettings,
  HERMES_PROVIDER_ID,
  normalizeHermesVisibleModels,
  updateHermesProviderSettings,
} from '../settings';
import { getHermesState } from '../types';

/**
 * These relocate Hermes' whole home — a different home means different
 * credentials, a different model catalog and, critically, a different session
 * store, so existing sessions can no longer be resumed.
 */
const HERMES_ENV_HASH_KEYS = ['HERMES_HOME', 'HERMES_PROFILE'] as const;

function computeHermesEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return HERMES_ENV_HASH_KEYS
    .filter((key) => envVars[key])
    .map((key) => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const hermesSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearHermesDiscoveryState(settings);
  },

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, HERMES_PROVIDER_ID);
    const currentHash = computeHermesEnvHash(envText);
    if (currentHash === getHermesProviderSettings(settings).environmentHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conversation of conversations) {
      if (conversation.providerId !== HERMES_PROVIDER_ID) {
        continue;
      }

      const state = getHermesState(conversation.providerState);
      if (!state.sessionId && !conversation.sessionId) {
        continue;
      }

      conversation.sessionId = null;
      conversation.providerState = undefined;
      invalidatedConversations.push(conversation);
    }

    updateHermesProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hermesSettings = getHermesProviderSettings(settings);
    let changed = false;

    const normalizeSelection = (value: unknown): string | null => {
      if (typeof value !== 'string' || !isHermesModelSelectionId(value)) {
        return null;
      }

      const rawModelId = decodeHermesModelId(value);
      if (!rawModelId) {
        return null;
      }

      const normalized = encodeHermesModelId(rawModelId);
      return normalized === value ? null : normalized;
    };

    const normalizedModel = normalizeSelection(settings.model);
    if (normalizedModel) {
      settings.model = normalizedModel;
      changed = true;
    }

    const normalizedTitleModel = normalizeSelection(settings.titleGenerationModel);
    if (normalizedTitleModel) {
      settings.titleGenerationModel = normalizedTitleModel;
      changed = true;
    }

    const savedProviderModel = settings.savedProviderModel;
    if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
      const projection = savedProviderModel as Record<string, unknown>;
      const normalizedSaved = normalizeSelection(projection[HERMES_PROVIDER_ID]);
      if (normalizedSaved) {
        projection[HERMES_PROVIDER_ID] = normalizedSaved;
        changed = true;
      }
    }

    // Compare against the RAW persisted config: `getHermesProviderSettings`
    // already normalizes on read, so comparing to it would always look clean
    // and leave a malformed value on disk forever.
    const persisted = getProviderConfig(settings, HERMES_PROVIDER_ID);
    const persistedVisibleModels = Array.isArray(persisted.visibleModels)
      ? persisted.visibleModels.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const persistedMode = typeof persisted.selectedMode === 'string' ? persisted.selectedMode : '';
    const normalizedVisibleModels = normalizeHermesVisibleModels(persistedVisibleModels);
    const normalizedMode = normalizeHermesSelectedMode(
      persistedMode,
      hermesSettings.availableModes,
    );

    if (
      !sameStringList(normalizedVisibleModels, persistedVisibleModels)
      || (persistedMode !== '' && normalizedMode !== persistedMode)
    ) {
      updateHermesProviderSettings(settings, {
        selectedMode: normalizedMode,
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    return changed;
  },
};
