import { sameDiscoveredModels, sameModes, sameThinkingOptionsByModel } from './internal/compareCollections';
import {
  normalizeOmpDiscoveredModels,
  normalizeOmpThinkingOptionsByModel,
  type OmpDiscoveredModel,
  type OmpThinkingOptionsByModel,
} from './models';
import {
  normalizeOmpAvailableModes,
  type OmpMode,
} from './modes';

const OMP_DISCOVERY_STATE = Symbol('ompDiscoveryState');

interface OmpDiscoveryState {
  availableModes: OmpMode[];
  discoveredModels: OmpDiscoveredModel[];
  thinkingOptionsByModel: OmpThinkingOptionsByModel;
}

type SettingsBag = Record<string | symbol, unknown>;

function ensureDiscoveryState(settings: Record<string, unknown>): OmpDiscoveryState {
  const bag = settings as SettingsBag;
  const existing = bag[OMP_DISCOVERY_STATE];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const state = existing as Partial<OmpDiscoveryState>;
    state.availableModes ??= [];
    state.discoveredModels ??= [];
    state.thinkingOptionsByModel ??= {};
    return state as OmpDiscoveryState;
  }

  const next: OmpDiscoveryState = {
    availableModes: [],
    discoveredModels: [],
    thinkingOptionsByModel: {},
  };
  bag[OMP_DISCOVERY_STATE] = next;
  return next;
}

function cloneModes(modes: OmpMode[]): OmpMode[] {
  return modes.map((mode) => ({ ...mode }));
}

function cloneDiscoveredModels(models: OmpDiscoveredModel[]): OmpDiscoveredModel[] {
  return models.map((model) => ({ ...model }));
}

function cloneThinkingOptionsByModel(
  optionsByModel: OmpThinkingOptionsByModel,
): OmpThinkingOptionsByModel {
  return Object.fromEntries(
    Object.entries(optionsByModel).map(([rawId, options]) => [
      rawId,
      options.map((option) => ({ ...option })),
    ]),
  );
}

export function getOmpDiscoveryState(settings: Record<string, unknown>): OmpDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    availableModes: cloneModes(state.availableModes),
    discoveredModels: cloneDiscoveredModels(state.discoveredModels),
    thinkingOptionsByModel: cloneThinkingOptionsByModel(state.thinkingOptionsByModel),
  };
}

export function updateOmpDiscoveryState(
  settings: Record<string, unknown>,
  updates: Partial<OmpDiscoveryState>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextAvailableModes = 'availableModes' in updates
    ? normalizeOmpAvailableModes(updates.availableModes)
    : state.availableModes;
  const nextDiscoveredModels = 'discoveredModels' in updates
    ? normalizeOmpDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const nextThinkingOptionsByModel = 'thinkingOptionsByModel' in updates
    ? normalizeOmpThinkingOptionsByModel(updates.thinkingOptionsByModel, nextDiscoveredModels)
    : state.thinkingOptionsByModel;
  const changed = !sameModes(state.availableModes, nextAvailableModes)
    || !sameDiscoveredModels(state.discoveredModels, nextDiscoveredModels)
    || !sameThinkingOptionsByModel(state.thinkingOptionsByModel, nextThinkingOptionsByModel);

  if (!changed) {
    return false;
  }

  state.availableModes = cloneModes(nextAvailableModes);
  state.discoveredModels = cloneDiscoveredModels(nextDiscoveredModels);
  state.thinkingOptionsByModel = cloneThinkingOptionsByModel(nextThinkingOptionsByModel);
  return true;
}

export function clearOmpDiscoveryState(settings: Record<string, unknown>): boolean {
  const state = ensureDiscoveryState(settings);
  if (
    state.availableModes.length === 0
    && state.discoveredModels.length === 0
    && Object.keys(state.thinkingOptionsByModel).length === 0
  ) {
    return false;
  }

  state.availableModes = [];
  state.discoveredModels = [];
  state.thinkingOptionsByModel = {};
  return true;
}

export function seedOmpDiscoveryStateFromLegacyConfig(
  settings: Record<string, unknown>,
  legacyConfig: Record<string, unknown>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextAvailableModes = state.availableModes.length > 0
    ? state.availableModes
    : normalizeOmpAvailableModes(legacyConfig.availableModes);
  const nextDiscoveredModels = state.discoveredModels.length > 0
    ? state.discoveredModels
    : normalizeOmpDiscoveredModels(legacyConfig.discoveredModels);
  const nextThinkingOptionsByModel = Object.keys(state.thinkingOptionsByModel).length > 0
    ? state.thinkingOptionsByModel
    : normalizeOmpThinkingOptionsByModel(legacyConfig.thinkingOptionsByModel, nextDiscoveredModels);

  return updateOmpDiscoveryState(settings, {
    availableModes: nextAvailableModes,
    discoveredModels: nextDiscoveredModels,
    thinkingOptionsByModel: nextThinkingOptionsByModel,
  });
}
