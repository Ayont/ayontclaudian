import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import {
  getOmpDiscoveryState,
  seedOmpDiscoveryStateFromLegacyConfig,
  updateOmpDiscoveryState,
} from './discoveryState';
import { ensureProviderProjectionMap } from './internal/providerProjection';
import {
  decodeOmpModelId,
  encodeOmpModelId,
  isOmpModelSelectionId,
  normalizeOmpThinkingOptionsByModel,
  OMP_DEFAULT_THINKING_LEVEL,
  type OmpDiscoveredModel,
  type OmpThinkingOptionsByModel,
  resolveOmpBaseModelRawId,
} from './models';
import {
  normalizeManagedOmpSelectedMode,
  type OmpMode,
} from './modes';

export interface PersistedOmpProviderSettings {
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  modelAliases: Record<string, string>;
  preferredThinkingByModel: Record<string, string>;
  selectedMode: string;
  thinkingOptionsByModel: OmpThinkingOptionsByModel;
  visibleModels: string[];
}

export interface OmpProviderSettings extends PersistedOmpProviderSettings {
  availableModes: OmpMode[];
  discoveredModels: OmpDiscoveredModel[];
}

export const OMP_DEFAULT_ENVIRONMENT_VARIABLES = 'OMP_ENABLE_EXA=1';

export const DEFAULT_OMP_PROVIDER_SETTINGS: Readonly<PersistedOmpProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: OMP_DEFAULT_ENVIRONMENT_VARIABLES,
  modelAliases: {},
  preferredThinkingByModel: {},
  selectedMode: '',
  thinkingOptionsByModel: {},
  visibleModels: [],
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

export function normalizeOmpVisibleModels(
  value: unknown,
  discoveredModels: OmpDiscoveredModel[] = [],
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = resolveOmpBaseModelRawId(entry.trim(), discoveredModels);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeOmpModelAliases(
  value: unknown,
  discoveredModels: OmpDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOmpBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function normalizeOmpPreferredThinkingByModel(
  value: unknown,
  discoveredModels: OmpDiscoveredModel[] = [],
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, thinkingLevel] of Object.entries(value as Record<string, unknown>)) {
    if (typeof thinkingLevel !== 'string') {
      continue;
    }

    const normalizedRawId = resolveOmpBaseModelRawId(rawId.trim(), discoveredModels);
    const normalizedThinkingLevel = thinkingLevel.trim();
    if (!normalizedRawId || !normalizedThinkingLevel) {
      continue;
    }

    normalized[normalizedRawId] = normalizedThinkingLevel;
  }

  return normalized;
}

export function getOmpProviderSettings(
  settings: Record<string, unknown>,
): OmpProviderSettings {
  const config = getProviderConfig(settings, 'omp');
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;
  seedOmpDiscoveryStateFromLegacyConfig(settings, config);
  const discoveryState = getOmpDiscoveryState(settings);
  const availableModes = discoveryState.availableModes;
  const discoveredModels = discoveryState.discoveredModels;
  const persistedThinkingOptionsByModel = normalizeOmpThinkingOptionsByModel(
    config.thinkingOptionsByModel,
    discoveredModels,
  );
  const thinkingOptionsByModel = normalizeOmpThinkingOptionsByModel({
    ...persistedThinkingOptionsByModel,
    ...discoveryState.thinkingOptionsByModel,
  }, discoveredModels);

  return {
    availableModes,
    cliPath: (config.cliPath as string | undefined)
      ?? DEFAULT_OMP_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels,
    enabled: (config.enabled as boolean | undefined)
      ?? DEFAULT_OMP_PROVIDER_SETTINGS.enabled,
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_OMP_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, 'omp')
      ?? DEFAULT_OMP_PROVIDER_SETTINGS.environmentVariables,
    modelAliases: normalizeOmpModelAliases(config.modelAliases, discoveredModels),
    preferredThinkingByModel: normalizeOmpPreferredThinkingByModel(
      config.preferredThinkingByModel,
      discoveredModels,
    ),
    selectedMode: normalizeManagedOmpSelectedMode(config.selectedMode, availableModes),
    thinkingOptionsByModel,
    visibleModels: normalizeOmpVisibleModels(config.visibleModels, discoveredModels),
  };
}

export function updateOmpProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<OmpProviderSettings>,
): OmpProviderSettings {
  const current = getOmpProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  if ('availableModes' in updates || 'discoveredModels' in updates || 'thinkingOptionsByModel' in updates) {
    updateOmpDiscoveryState(settings, {
      ...(updates.availableModes !== undefined ? { availableModes: updates.availableModes } : {}),
      ...(updates.discoveredModels !== undefined ? { discoveredModels: updates.discoveredModels } : {}),
      ...(updates.thinkingOptionsByModel !== undefined
        ? { thinkingOptionsByModel: updates.thinkingOptionsByModel }
        : {}),
    });
  }
  const discoveryState = getOmpDiscoveryState(settings);
  const nextAvailableModes = discoveryState.availableModes;
  const nextDiscoveredModels = discoveryState.discoveredModels;
  const nextThinkingOptionsByModel = updates.thinkingOptionsByModel !== undefined
    ? discoveryState.thinkingOptionsByModel
    : normalizeOmpThinkingOptionsByModel(
      current.thinkingOptionsByModel,
      nextDiscoveredModels,
    );
  const nextSelectedMode = normalizeManagedOmpSelectedMode(
    updates.selectedMode ?? current.selectedMode,
    nextAvailableModes,
  );
  const nextVisibleModels = normalizeOmpVisibleModels(
    updates.visibleModels ?? current.visibleModels,
    nextDiscoveredModels,
  );
  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeOmpModelAliases(
      updates.modelAliases ?? current.modelAliases,
      nextDiscoveredModels,
    ),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (
      typeof updates.cliPath === 'string'
        ? updates.cliPath.trim()
        : DEFAULT_OMP_PROVIDER_SETTINGS.cliPath
    )
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_OMP_PROVIDER_SETTINGS.cliPath;
  }

  const next: OmpProviderSettings = {
    ...current,
    ...updates,
    availableModes: nextAvailableModes,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: nextDiscoveredModels,
    modelAliases: nextModelAliases,
    preferredThinkingByModel: normalizeOmpPreferredThinkingByModel(
      updates.preferredThinkingByModel ?? current.preferredThinkingByModel,
      nextDiscoveredModels,
    ),
    selectedMode: nextSelectedMode,
    thinkingOptionsByModel: nextThinkingOptionsByModel,
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedOmpSelections(settings, next);
  }

  const persistedThinkingOptionsByModel = pruneThinkingOptionsToPersistedSelections(
    settings,
    next,
  );

  setProviderConfig(settings, 'omp', {
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    modelAliases: next.modelAliases,
    preferredThinkingByModel: next.preferredThinkingByModel,
    selectedMode: next.selectedMode,
    thinkingOptionsByModel: persistedThinkingOptionsByModel,
    visibleModels: next.visibleModels,
  });

  return next;
}

export function hasLegacyOmpDiscoveryFields(settings: Record<string, unknown>): boolean {
  const config = getProviderConfig(settings, 'omp');
  return 'availableModes' in config || 'discoveredModels' in config;
}

function pruneModelAliasesToVisible(
  aliases: Record<string, string>,
  visibleModels: string[],
): Record<string, string> {
  if (visibleModels.length === 0 || Object.keys(aliases).length === 0) {
    return {};
  }

  const visibleSet = new Set(visibleModels);
  const pruned: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(aliases)) {
    if (visibleSet.has(rawId)) {
      pruned[rawId] = alias;
    }
  }
  return pruned;
}

function pruneThinkingOptionsToPersistedSelections(
  settings: Record<string, unknown>,
  next: OmpProviderSettings,
): OmpThinkingOptionsByModel {
  const persistableRawIds = new Set(next.visibleModels);
  addPersistableSelection(persistableRawIds, settings.model, next.discoveredModels);
  addPersistableSelection(persistableRawIds, settings.titleGenerationModel, next.discoveredModels);

  const savedProviderModel = settings.savedProviderModel;
  if (savedProviderModel && typeof savedProviderModel === 'object' && !Array.isArray(savedProviderModel)) {
    addPersistableSelection(
      persistableRawIds,
      (savedProviderModel as Record<string, unknown>).omp,
      next.discoveredModels,
    );
  }

  const pruned: OmpThinkingOptionsByModel = {};
  for (const rawId of persistableRawIds) {
    const options = next.thinkingOptionsByModel[rawId];
    if (options?.length) {
      pruned[rawId] = options.map((option) => ({ ...option }));
    }
  }
  return pruned;
}

function addPersistableSelection(
  target: Set<string>,
  value: unknown,
  discoveredModels: OmpDiscoveredModel[],
): void {
  if (typeof value !== 'string' || !isOmpModelSelectionId(value)) {
    return;
  }

  const rawModelId = decodeOmpModelId(value);
  if (!rawModelId) {
    return;
  }

  const baseRawId = resolveOmpBaseModelRawId(rawModelId, discoveredModels);
  if (baseRawId) {
    target.add(baseRawId);
  }
}

function retargetRemovedOmpSelections(
  settings: Record<string, unknown>,
  next: OmpProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    if (
      typeof settings.titleGenerationModel === 'string'
      && isOmpModelSelectionId(settings.titleGenerationModel)
    ) {
      settings.titleGenerationModel = '';
    }
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackRawId = next.visibleModels[0];
  const fallbackModelId = encodeOmpModelId(fallbackRawId);
  const fallbackEffort = next.preferredThinkingByModel[fallbackRawId] ?? OMP_DEFAULT_THINKING_LEVEL;

  const maybeRetargetModel = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isOmpModelSelectionId(value)) {
      return null;
    }

    const rawModelId = decodeOmpModelId(value);
    if (!rawModelId) {
      return fallbackModelId;
    }

    const baseRawId = resolveOmpBaseModelRawId(rawModelId, next.discoveredModels);
    return visibleSet.has(baseRawId) ? null : fallbackModelId;
  };

  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const nextSavedModel = maybeRetargetModel(savedProviderModel.omp);
  if (nextSavedModel) {
    savedProviderModel.omp = nextSavedModel;
    ensureProviderProjectionMap(settings, 'savedProviderEffort').omp = fallbackEffort;
  }

  const nextTopLevelModel = maybeRetargetModel(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
    settings.effortLevel = fallbackEffort;
  }

  const nextTitleGenerationModel = maybeRetargetModel(settings.titleGenerationModel);
  if (nextTitleGenerationModel) {
    settings.titleGenerationModel = nextTitleGenerationModel;
  }
}
