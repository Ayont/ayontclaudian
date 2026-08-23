import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import { getProviderEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../core/types/settings';
import {
  getHostnameKey,
  getLegacyHostnameKey,
  migrateLegacyHostnameKeyedMap,
} from '../../utils/env';
import { getHermesDiscoveryState } from './discoveryState';
import { ensureProviderProjectionMap } from './internal/providerProjection';
import {
  decodeHermesModelId,
  encodeHermesModelId,
  type HermesDiscoveredModel,
  isHermesModelSelectionId,
} from './models';
import { HERMES_DEFAULT_MODE_ID, type HermesMode, normalizeHermesSelectedMode } from './modes';

export const HERMES_PROVIDER_ID = 'hermes';

export interface PersistedHermesProviderSettings {
  /** Auto-approve unseen shell hooks (`hermes acp --accept-hooks`). */
  acceptHooks: boolean;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  enabled: boolean;
  environmentHash: string;
  environmentVariables: string;
  /** Prepend Claudian's vault system prompt to the first turn of each session. */
  injectVaultPrompt: boolean;
  modelAliases: Record<string, string>;
  selectedMode: string;
  visibleModels: string[];
  /** Bypass Hermes' dangerous-command approval prompts (`HERMES_YOLO_MODE`). */
  yoloMode: boolean;
}

export interface HermesProviderSettings extends PersistedHermesProviderSettings {
  availableModes: HermesMode[];
  discoveredModels: HermesDiscoveredModel[];
}

export const DEFAULT_HERMES_PROVIDER_SETTINGS: Readonly<PersistedHermesProviderSettings> = Object.freeze({
  acceptHooks: false,
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentHash: '',
  environmentVariables: '',
  injectVaultPrompt: true,
  modelAliases: {},
  selectedMode: HERMES_DEFAULT_MODE_ID,
  visibleModels: [],
  yoloMode: false,
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

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeHermesVisibleModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

export function normalizeHermesModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawId, alias] of Object.entries(value as Record<string, unknown>)) {
    if (typeof alias !== 'string') {
      continue;
    }

    const normalizedRawId = rawId.trim();
    const normalizedAlias = alias.trim();
    if (!normalizedRawId || !normalizedAlias) {
      continue;
    }

    normalized[normalizedRawId] = normalizedAlias;
  }

  return normalized;
}

export function getHermesProviderSettings(
  settings: Record<string, unknown>,
): HermesProviderSettings {
  const config = getProviderConfig(settings, HERMES_PROVIDER_ID);
  const normalizedCliPathsByHost = normalizeHostnameCliPaths(config.cliPathsByHost);
  const cliPathsByHost = Object.keys(normalizedCliPathsByHost).length > 0
    ? migrateLegacyHostnameKeyedMap(
      normalizedCliPathsByHost,
      getHostnameKey(),
      getLegacyHostnameKey(),
    )
    : normalizedCliPathsByHost;
  const discoveryState = getHermesDiscoveryState(settings);

  return {
    acceptHooks: normalizeBoolean(
      config.acceptHooks,
      DEFAULT_HERMES_PROVIDER_SETTINGS.acceptHooks,
    ),
    availableModes: discoveryState.availableModes,
    cliPath: (config.cliPath as string | undefined) ?? DEFAULT_HERMES_PROVIDER_SETTINGS.cliPath,
    cliPathsByHost,
    discoveredModels: discoveryState.discoveredModels,
    enabled: normalizeBoolean(config.enabled, DEFAULT_HERMES_PROVIDER_SETTINGS.enabled),
    environmentHash: (config.environmentHash as string | undefined)
      ?? DEFAULT_HERMES_PROVIDER_SETTINGS.environmentHash,
    environmentVariables: (config.environmentVariables as string | undefined)
      ?? getProviderEnvironmentVariables(settings, HERMES_PROVIDER_ID)
      ?? DEFAULT_HERMES_PROVIDER_SETTINGS.environmentVariables,
    injectVaultPrompt: normalizeBoolean(
      config.injectVaultPrompt,
      DEFAULT_HERMES_PROVIDER_SETTINGS.injectVaultPrompt,
    ),
    modelAliases: normalizeHermesModelAliases(config.modelAliases),
    selectedMode: normalizeHermesSelectedMode(config.selectedMode, discoveryState.availableModes),
    visibleModels: normalizeHermesVisibleModels(config.visibleModels),
    yoloMode: normalizeBoolean(config.yoloMode, DEFAULT_HERMES_PROVIDER_SETTINGS.yoloMode),
  };
}

export function updateHermesProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<HermesProviderSettings>,
): HermesProviderSettings {
  const current = getHermesProviderSettings(settings);
  const hostnameKey = getHostnameKey();
  const nextVisibleModels = normalizeHermesVisibleModels(
    updates.visibleModels ?? current.visibleModels,
  );
  const nextModelAliases = pruneModelAliasesToVisible(
    normalizeHermesModelAliases(updates.modelAliases ?? current.modelAliases),
    nextVisibleModels,
  );
  const nextCliPathsByHost = 'cliPathsByHost' in updates
    ? normalizeHostnameCliPaths(updates.cliPathsByHost)
    : { ...current.cliPathsByHost };
  let nextCliPath = 'cliPathsByHost' in updates
    ? (typeof updates.cliPath === 'string' ? updates.cliPath.trim() : DEFAULT_HERMES_PROVIDER_SETTINGS.cliPath)
    : current.cliPath.trim();

  if ('cliPath' in updates && !('cliPathsByHost' in updates)) {
    const trimmedCliPath = typeof updates.cliPath === 'string' ? updates.cliPath.trim() : '';
    if (trimmedCliPath) {
      nextCliPathsByHost[hostnameKey] = trimmedCliPath;
    } else {
      delete nextCliPathsByHost[hostnameKey];
    }
    nextCliPath = DEFAULT_HERMES_PROVIDER_SETTINGS.cliPath;
  }

  const next: HermesProviderSettings = {
    ...current,
    ...updates,
    availableModes: current.availableModes,
    cliPath: nextCliPath,
    cliPathsByHost: nextCliPathsByHost,
    discoveredModels: current.discoveredModels,
    modelAliases: nextModelAliases,
    selectedMode: normalizeHermesSelectedMode(
      updates.selectedMode ?? current.selectedMode,
      current.availableModes,
    ),
    visibleModels: nextVisibleModels,
  };

  if (updates.visibleModels !== undefined) {
    retargetRemovedHermesSelections(settings, next);
  }

  setProviderConfig(settings, HERMES_PROVIDER_ID, {
    acceptHooks: next.acceptHooks,
    cliPath: next.cliPath,
    cliPathsByHost: next.cliPathsByHost,
    enabled: next.enabled,
    environmentHash: next.environmentHash,
    environmentVariables: next.environmentVariables,
    injectVaultPrompt: next.injectVaultPrompt,
    modelAliases: next.modelAliases,
    selectedMode: next.selectedMode,
    visibleModels: next.visibleModels,
    yoloMode: next.yoloMode,
  });

  return next;
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

/**
 * Hiding the model a saved selection points at would leave the picker on an
 * entry the user can no longer see; retarget those selections to the first
 * still-visible model instead.
 */
function retargetRemovedHermesSelections(
  settings: Record<string, unknown>,
  next: HermesProviderSettings,
): void {
  if (next.visibleModels.length === 0) {
    if (
      typeof settings.titleGenerationModel === 'string'
      && isHermesModelSelectionId(settings.titleGenerationModel)
    ) {
      settings.titleGenerationModel = '';
    }
    return;
  }

  const visibleSet = new Set(next.visibleModels);
  const fallbackModelId = encodeHermesModelId(next.visibleModels[0]);

  const maybeRetargetModel = (value: unknown): string | null => {
    if (typeof value !== 'string' || !isHermesModelSelectionId(value)) {
      return null;
    }

    const rawModelId = decodeHermesModelId(value);
    if (!rawModelId) {
      return fallbackModelId;
    }

    return visibleSet.has(rawModelId) ? null : fallbackModelId;
  };

  const savedProviderModel = ensureProviderProjectionMap(settings, 'savedProviderModel');
  const nextSavedModel = maybeRetargetModel(savedProviderModel[HERMES_PROVIDER_ID]);
  if (nextSavedModel) {
    savedProviderModel[HERMES_PROVIDER_ID] = nextSavedModel;
  }

  const nextTopLevelModel = maybeRetargetModel(settings.model);
  if (nextTopLevelModel) {
    settings.model = nextTopLevelModel;
  }

  const nextTitleGenerationModel = maybeRetargetModel(settings.titleGenerationModel);
  if (nextTitleGenerationModel) {
    settings.titleGenerationModel = nextTitleGenerationModel;
  }
}
