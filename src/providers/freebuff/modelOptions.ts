import type { ProviderUIOption } from '../../core/providers/types';
import { getFreebuffProviderSettings } from './settings';
import { DEFAULT_FREEBUFF_MODELS, formatFreebuffModelLabel } from './types/models';

/** Parse the newline-separated custom model id list, de-duplicated. */
export function parseConfiguredCustomModelIds(value: string): string[] {
  const modelIds: string[] = [];
  const seen = new Set<string>();
  for (const line of value.split(/\r?\n/)) {
    const modelId = line.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    modelIds.push(modelId);
  }
  return modelIds;
}

/** Model dropdown: verified harness catalog plus user-typed custom ids. */
export function getFreebuffModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const models = [...DEFAULT_FREEBUFF_MODELS];
  const seen = new Set(models.map((model) => model.value));
  for (const modelId of parseConfiguredCustomModelIds(getFreebuffProviderSettings(settings).customModels)) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    models.push({
      value: modelId,
      label: formatFreebuffModelLabel(modelId),
      description: 'Eigenes Modell',
    });
  }
  return models;
}