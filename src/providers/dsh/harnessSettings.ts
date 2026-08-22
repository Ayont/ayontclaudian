import { dump,load } from 'js-yaml';

import type { ProviderUIOption } from '../../core/providers/types';
import { DEFAULT_DSH_CONTEXT_WINDOW } from './types/models';

export interface DshHarnessModel {
  id: string;
  name?: string;
}

export interface DshHarnessProvider {
  id: string;
  displayName?: string;
  models: DshHarnessModel[];
}

export interface DshActiveModel {
  provider: string;
  model: string;
}

/** Dropdown values encode provider and model; '|' cannot appear in either id. */
export function dshSelectionValue(provider: string, model: string): string {
  return `${provider}|${model}`;
}

export function splitDshSelectionValue(value: string): DshActiveModel | null {
  const separator = value.indexOf('|');
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  return { provider: value.slice(0, separator), model: value.slice(separator + 1) };
}

function parseYaml(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) {
    return null;
  }
  try {
    const parsed = load(text);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** Every provider that declares an explicit model list in the harness yaml. */
export function parseDshHarnessProviders(yamlText: string | null | undefined): DshHarnessProvider[] {
  const doc = parseYaml(yamlText);
  const section = doc?.['llm-pi-ai'] as Record<string, unknown> | undefined;
  const providers = section?.['providers'] as Record<string, Record<string, unknown>> | undefined;
  if (!providers || typeof providers !== 'object') {
    return [];
  }
  const result: DshHarnessProvider[] = [];
  for (const [id, config] of Object.entries(providers)) {
    if (!config || typeof config !== 'object') {
      continue;
    }
    const rawModels = Array.isArray(config['models']) ? config['models'] : [];
    const models: DshHarnessModel[] = [];
    for (const entry of rawModels) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const modelId = typeof record['id'] === 'string' ? record['id'].trim() : '';
      if (!modelId) {
        continue;
      }
      models.push({
        id: modelId,
        name: typeof record['name'] === 'string' ? record['name'] : undefined,
      });
    }
    if (models.length === 0) {
      continue;
    }
    result.push({
      id,
      displayName: typeof config['displayName'] === 'string' ? config['displayName'] : undefined,
      models,
    });
  }
  return result;
}

export function parseDshActiveModel(yamlText: string | null | undefined): DshActiveModel | null {
  const doc = parseYaml(yamlText);
  const active = doc?.['agent-default-model'] as Record<string, unknown> | undefined;
  const provider = typeof active?.['provider'] === 'string' ? active['provider'] : '';
  const model = typeof active?.['model'] === 'string' ? active['model'] : '';
  return provider && model ? { provider, model } : null;
}

/** One dropdown option per configured harness model. */
export function buildDshModelOptionsFromHarness(providers: readonly DshHarnessProvider[]): ProviderUIOption[] {
  const options: ProviderUIOption[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      options.push({
        value: dshSelectionValue(provider.id, model.id),
        label: model.name ?? model.id,
        description: `${model.id} · via ${provider.displayName ?? provider.id} · ${DEFAULT_DSH_CONTEXT_WINDOW / 1000}k Kontext`,
      });
    }
  }
  return options;
}

/** Pure yaml rewrite: swaps agent-default-model, keeps everything else intact. */
export function applyDshDefaultModelToYaml(
  yamlText: string,
  provider: string,
  model: string,
): string | null {
  const doc = parseYaml(yamlText);
  if (!doc) {
    return null;
  }
  doc['agent-default-model'] = { provider, model };
  try {
    return dump(doc, { indent: 2, lineWidth: -1 });
  } catch {
    return null;
  }
}
