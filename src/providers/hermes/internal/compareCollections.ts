import type { HermesDiscoveredModel } from '../models';
import type { HermesMode } from '../modes';

export function sameStringList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => entry === right[index]);
}

export function sameStringMap(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

export function sameHermesModes(left: HermesMode[], right: HermesMode[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((mode, index) => (
    mode.id === right[index]?.id
    && mode.name === right[index]?.name
    && (mode.description ?? '') === (right[index]?.description ?? '')
  ));
}

export function sameHermesDiscoveredModels(
  left: HermesDiscoveredModel[],
  right: HermesDiscoveredModel[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((model, index) => (
    model.rawId === right[index]?.rawId
    && model.label === right[index]?.label
    && (model.description ?? '') === (right[index]?.description ?? '')
  ));
}
