import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderSettingsReconciler } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { parseEnvironmentVariables } from '../../../utils/env';
import { clearOmpDiscoveryState } from '../discoveryState';
import { sameStringList, sameStringMap } from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeOmpModelId,
  encodeOmpModelId,
  extractOmpModelVariantValue,
  isOmpModelSelectionId,
  OMP_DEFAULT_THINKING_LEVEL,
  resolveOmpBaseModelRawId,
} from '../models';
import {
  getOmpProviderSettings,
  hasLegacyOmpDiscoveryFields,
  normalizeOmpPreferredThinkingByModel,
  normalizeOmpVisibleModels,
  updateOmpProviderSettings,
} from '../settings';

interface NormalizedSelection {
  baseModelId: string | null;
  variant: string | null;
}

const OMP_ENV_HASH_KEYS = [
  'OMP_CONFIG',
  'OMP_DB',
  'OMP_DISABLE_PROJECT_CONFIG',
  'XDG_DATA_HOME',
] as const;

function computeOmpEnvHash(envText: string): string {
  const envVars = parseEnvironmentVariables(envText || '');
  return OMP_ENV_HASH_KEYS
    .filter((key) => envVars[key])
    .map((key) => `${key}=${envVars[key]}`)
    .sort()
    .join('|');
}

export const ompSettingsReconciler: ProviderSettingsReconciler = {
  handleEnvironmentChange(settings: Record<string, unknown>): boolean {
    return clearOmpDiscoveryState(settings);
  },

  reconcileModelWithEnvironment(
    settings: Record<string, unknown>,
    conversations: Conversation[],
  ): { changed: boolean; invalidatedConversations: Conversation[] } {
    const envText = getRuntimeEnvironmentText(settings, 'omp');
    const currentHash = computeOmpEnvHash(envText);
    const savedHash = getOmpProviderSettings(settings).environmentHash;

    if (currentHash === savedHash) {
      return { changed: false, invalidatedConversations: [] };
    }

    const invalidatedConversations: Conversation[] = [];
    for (const conversation of conversations) {
      if (conversation.providerId !== 'omp') {
        continue;
      }

      if (!conversation.sessionId) {
        continue;
      }

      conversation.sessionId = null;
      conversation.providerState = undefined;
      invalidatedConversations.push(conversation);
    }

    updateOmpProviderSettings(settings, { environmentHash: currentHash });
    return { changed: true, invalidatedConversations };
  },

  normalizeModelVariantSettings(settings: Record<string, unknown>): boolean {
    const hadLegacyDiscoveryFields = hasLegacyOmpDiscoveryFields(settings);
    if (hadLegacyDiscoveryFields) {
      updateOmpProviderSettings(settings, {});
    }

    const ompSettings = getOmpProviderSettings(settings);
    let changed = hadLegacyDiscoveryFields;

    const normalizeSelection = (value: unknown): NormalizedSelection => {
      if (typeof value !== 'string' || !isOmpModelSelectionId(value)) {
        return { baseModelId: null, variant: null };
      }

      const rawModelId = decodeOmpModelId(value);
      if (!rawModelId) {
        return { baseModelId: value, variant: null };
      }

      const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
      return {
        baseModelId: encodeOmpModelId(baseRawId),
        variant: extractOmpModelVariantValue(rawModelId, ompSettings.discoveredModels),
      };
    };

    const modelSelection = normalizeSelection(settings.model);
    if (typeof settings.model === 'string' && modelSelection.baseModelId && settings.model !== modelSelection.baseModelId) {
      settings.model = modelSelection.baseModelId;
      changed = true;
    }
    if (
      modelSelection.variant
      && (typeof settings.effortLevel !== 'string' || settings.effortLevel.trim().length === 0)
    ) {
      settings.effortLevel = modelSelection.variant;
      changed = true;
    }

    const titleModelSelection = normalizeSelection(settings.titleGenerationModel);
    if (
      typeof settings.titleGenerationModel === 'string'
      && titleModelSelection.baseModelId
      && settings.titleGenerationModel !== titleModelSelection.baseModelId
    ) {
      settings.titleGenerationModel = titleModelSelection.baseModelId;
      changed = true;
    }

    const savedProviderModelRaw = settings.savedProviderModel;
    if (savedProviderModelRaw && typeof savedProviderModelRaw === 'object' && !Array.isArray(savedProviderModelRaw)) {
      const savedProviderModel = savedProviderModelRaw as Record<string, unknown>;
      const savedSelection = normalizeSelection(savedProviderModel.omp);
      if (
        typeof savedProviderModel.omp === 'string'
        && savedSelection.baseModelId
        && savedProviderModel.omp !== savedSelection.baseModelId
      ) {
        savedProviderModel.omp = savedSelection.baseModelId;
        changed = true;
      }
      if (savedSelection.variant) {
        const savedEffort = ensureProviderProjectionMap(settings, 'savedProviderEffort');
        if (typeof savedEffort.omp !== 'string') {
          savedEffort.omp = savedSelection.variant;
          changed = true;
        }
      }
    }

    const normalizedVisibleModels = normalizeOmpVisibleModels(
      ompSettings.visibleModels,
      ompSettings.discoveredModels,
    );
    const normalizedPreferredThinking = normalizeOmpPreferredThinkingByModel(
      ompSettings.preferredThinkingByModel,
      ompSettings.discoveredModels,
    );
    const shouldUpdateProviderSettings = !sameStringList(normalizedVisibleModels, ompSettings.visibleModels)
      || !sameStringMap(normalizedPreferredThinking, ompSettings.preferredThinkingByModel);
    if (shouldUpdateProviderSettings) {
      updateOmpProviderSettings(settings, {
        preferredThinkingByModel: normalizedPreferredThinking,
        visibleModels: normalizedVisibleModels,
      });
      changed = true;
    }

    if (typeof settings.effortLevel === 'string' && !settings.effortLevel.trim()) {
      settings.effortLevel = OMP_DEFAULT_THINKING_LEVEL;
      changed = true;
    }

    return changed;
  },
};
