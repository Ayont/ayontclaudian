import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import { getModelsFromEnvironment } from './env/claudeModelEnv';
import { formatCustomModelLabel } from './modelLabels';
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS, getClaudeProviderSettings } from './settings';
import {
  DEFAULT_CLAUDE_MODELS,
  filterVisibleModelOptions,
  migrateLegacyClaudeModelAlias,
} from './types/models';

function parseConfiguredCustomModelIds(value: string): string[] {
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

function normalizeCustomModelAliases(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const aliases: Record<string, string> = {};
  for (const [rawModelId, rawAlias] of Object.entries(value)) {
    if (typeof rawAlias !== 'string') {
      continue;
    }

    const modelId = rawModelId.trim();
    const alias = rawAlias.trim();
    if (modelId && alias) {
      aliases[modelId] = alias;
    }
  }

  return aliases;
}

export function getClaudeModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const customModelAliases = normalizeCustomModelAliases(settings.customModelAliases);
  const customModels = getModelsFromEnvironment(
    getRuntimeEnvironmentVariables(settings, 'claude'),
    customModelAliases,
  );
  if (customModels.length > 0) {
    return customModels;
  }

  const claudeSettings = getClaudeProviderSettings(settings);
  const models = filterVisibleModelOptions(
    [...DEFAULT_CLAUDE_MODELS],
    claudeSettings.enableOpus1M,
    claudeSettings.enableSonnet1M,
  );

  const seenValues = new Set(models.map(model => model.value));
  for (const modelId of parseConfiguredCustomModelIds(claudeSettings.customModels)) {
    if (seenValues.has(modelId)) {
      continue;
    }

    seenValues.add(modelId);
    models.push({
      value: modelId,
      label: customModelAliases[modelId] ?? formatCustomModelLabel(modelId),
      description: 'Eigenes Modell',
    });
  }

  return models;
}

export function resolveClaudeModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const modelOptions = getClaudeModelOptions(settings);
  const isOffered = (model: string): boolean => modelOptions.some(option => option.value === model);

  // Persisted floating aliases (`opus`, `sonnet`, `haiku`, ...) from older builds
  // resolve to the pinned catalog id the CLI maps them to today.
  for (const candidate of [currentModel, getClaudeProviderSettings(settings).lastModel]) {
    if (!candidate) continue;
    if (isOffered(candidate)) return candidate;
    const migrated = migrateLegacyClaudeModelAlias(candidate);
    if (migrated !== candidate && isOffered(migrated)) return migrated;
  }

  // Last resort: the default tier, never index 0. The catalog puts Fable 5.1
  // first for picker order; a fallback must not silently select the model that
  // consumes usage credits.
  const safeDefault = DEFAULT_CLAUDE_PROVIDER_SETTINGS.lastModel;
  if (isOffered(safeDefault)) return safeDefault;
  return modelOptions[0]?.value ?? null;
}
