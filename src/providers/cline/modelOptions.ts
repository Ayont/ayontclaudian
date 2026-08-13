import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import { getClineProviderSettings } from './settings';
import {
  CLINE_PASS_MODELS,
  DEFAULT_CLINE_CONTEXT_WINDOW,
  DEFAULT_CLINE_MODEL_SET,
  DEFAULT_CLINE_MODELS,
  DEFAULT_CLINE_PRIMARY_MODEL,
  formatClineModelLabel,
  getClineModelContextWindow as getCatalogContextWindow,
  toClineModelOption,
} from './types/models';

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

export function getClineModelContextWindow(model: string): number {
  return getCatalogContextWindow(model) || DEFAULT_CLINE_CONTEXT_WINDOW;
}

function getConfiguredEnvModel(settings: Record<string, unknown>): string | null {
  const modelId = getRuntimeEnvironmentVariables(settings, 'cline').CLINE_MODEL?.trim();
  return modelId || null;
}

export function getClineModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const models = CLINE_PASS_MODELS.map((meta) => ({
    ...toClineModelOption(meta),
    isDefault: meta.id === DEFAULT_CLINE_PRIMARY_MODEL,
  }));
  const seen = new Set(models.map((model) => model.value));

  const envModel = getConfiguredEnvModel(settings);
  if (envModel && !seen.has(envModel)) {
    seen.add(envModel);
    models.unshift({
      value: envModel,
      label: formatClineModelLabel(envModel),
      description: 'Custom (env)',
      group: 'Custom',
      providerId: 'cline',
      isDefault: false,
    });
  }

  const clineSettings = getClineProviderSettings(settings);
  for (const modelId of parseConfiguredCustomModelIds(clineSettings.customModels)) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    models.push({
      value: modelId,
      label: formatClineModelLabel(modelId),
      description: 'Eigenes Modell',
      group: 'Custom',
      providerId: 'cline',
      isDefault: false,
    });
  }

  return models;
}

export function resolveClineModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const envModel = getConfiguredEnvModel(settings);
  if (envModel) {
    return envModel;
  }
  const options = getClineModelOptions(settings);
  if (currentModel && options.some((option) => option.value === currentModel)) {
    return currentModel;
  }
  return options[0]?.value ?? DEFAULT_CLINE_PRIMARY_MODEL;
}

export { DEFAULT_CLINE_MODEL_SET,DEFAULT_CLINE_MODELS };
