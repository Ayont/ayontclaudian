/**
 * Session-scoped discovery cache for the Hermes ACP catalog.
 *
 * The model and mode lists come from the live ACP server, are large (47+
 * entries on a normally configured install), and change whenever the user adds
 * or removes provider credentials in Hermes itself. Keeping them off disk means
 * a stale catalog can never outlive a plugin restart — only the user's own
 * choices (visible models, aliases, selected mode) are persisted.
 */

import { sameHermesDiscoveredModels, sameHermesModes } from './internal/compareCollections';
import { type HermesDiscoveredModel, normalizeHermesDiscoveredModels } from './models';
import { type HermesMode, normalizeHermesAvailableModes } from './modes';

const HERMES_DISCOVERY_STATE = Symbol('hermesDiscoveryState');

interface HermesDiscoveryState {
  availableModes: HermesMode[];
  discoveredModels: HermesDiscoveredModel[];
}

type SettingsBag = Record<string | symbol, unknown>;

function ensureDiscoveryState(settings: Record<string, unknown>): HermesDiscoveryState {
  const bag = settings as SettingsBag;
  const existing = bag[HERMES_DISCOVERY_STATE];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const state = existing as Partial<HermesDiscoveryState>;
    state.availableModes ??= [];
    state.discoveredModels ??= [];
    return state as HermesDiscoveryState;
  }

  const next: HermesDiscoveryState = {
    availableModes: [],
    discoveredModels: [],
  };
  bag[HERMES_DISCOVERY_STATE] = next;
  return next;
}

export function getHermesDiscoveryState(settings: Record<string, unknown>): HermesDiscoveryState {
  const state = ensureDiscoveryState(settings);
  return {
    availableModes: state.availableModes.map((mode) => ({ ...mode })),
    discoveredModels: state.discoveredModels.map((model) => ({ ...model })),
  };
}

export function updateHermesDiscoveryState(
  settings: Record<string, unknown>,
  updates: Partial<HermesDiscoveryState>,
): boolean {
  const state = ensureDiscoveryState(settings);
  const nextAvailableModes = 'availableModes' in updates
    ? normalizeHermesAvailableModes(updates.availableModes)
    : state.availableModes;
  const nextDiscoveredModels = 'discoveredModels' in updates
    ? normalizeHermesDiscoveredModels(updates.discoveredModels)
    : state.discoveredModels;
  const changed = !sameHermesModes(state.availableModes, nextAvailableModes)
    || !sameHermesDiscoveredModels(state.discoveredModels, nextDiscoveredModels);

  if (!changed) {
    return false;
  }

  state.availableModes = nextAvailableModes.map((mode) => ({ ...mode }));
  state.discoveredModels = nextDiscoveredModels.map((model) => ({ ...model }));
  return true;
}

export function clearHermesDiscoveryState(settings: Record<string, unknown>): boolean {
  const state = ensureDiscoveryState(settings);
  if (state.availableModes.length === 0 && state.discoveredModels.length === 0) {
    return false;
  }

  state.availableModes = [];
  state.discoveredModels = [];
  return true;
}
