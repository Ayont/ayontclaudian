import * as fs from 'node:fs';

import { parse as parseToml } from 'smol-toml';

import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import { getGrokConfigPath } from './history/GrokSessionStore';
import { getGrokProviderSettings } from './settings';
import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_MODEL_SET,
  DEFAULT_GROK_MODELS,
  DEFAULT_GROK_PRIMARY_MODEL,
  formatGrokModelLabel,
} from './types/models';

/** A model discovered from `~/.grok/config.toml` `[models.*]`. */
export interface GrokConfiguredModel {
  id: string;
  label: string;
  contextWindow: number;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toContextWindow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_GROK_CONTEXT_WINDOW;
}

/**
 * Memoized snapshot of the parsed config file. The model dropdown rebuilds
 * (and re-reads this file) on every chat render otherwise; a stat-based
 * signature keeps repeat reads cheap while still noticing external edits
 * (mtime/size changes).
 */
interface GrokConfigCacheEntry {
  signature: string;
  models: GrokConfiguredModel[];
  defaultModel: string | null;
}

let grokConfigCache: GrokConfigCacheEntry | null = null;

function computeGrokConfigSignature(configPath: string): string {
  try {
    const stat = fs.statSync(configPath);
    return `${configPath}:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return `${configPath}:missing`;
  }
}

/**
 * Reads `[models.*]` tables and `default_model` from `~/.grok/config.toml`.
 *
 * Never throws: a missing or malformed config yields an empty list, and the
 * built-in default model carries the dropdown on its own.
 */
export function readGrokConfiguredModels(): {
  models: GrokConfiguredModel[];
  defaultModel: string | null;
} {
  const configPath = getGrokConfigPath();
  const signature = computeGrokConfigSignature(configPath);
  if (grokConfigCache && grokConfigCache.signature === signature) {
    return { models: grokConfigCache.models, defaultModel: grokConfigCache.defaultModel };
  }

  const models: GrokConfiguredModel[] = [];
  let defaultModel: string | null = null;

  // A missing or malformed config is skipped silently, leaving the list empty.
  let raw: string | null;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    raw = null;
  }

  let parsed: Record<string, unknown> | null = null;
  if (raw !== null) {
    try {
      parsed = toRecord(parseToml(raw));
    } catch {
      parsed = null;
    }
  }

  if (parsed) {
    const modelsTable = toRecord(parsed.models);
    if (modelsTable) {
      for (const [id, entry] of Object.entries(modelsTable)) {
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        const displayName = typeof record.display_name === 'string' ? record.display_name.trim() : '';
        models.push({
          id,
          label: displayName ? `Grok · ${displayName}` : formatGrokModelLabel(id),
          contextWindow: toContextWindow(record.max_context_size),
        });
      }
    }

    defaultModel = typeof parsed.default_model === 'string' && parsed.default_model.trim()
      ? parsed.default_model.trim()
      : null;
  }

  grokConfigCache = { signature, models, defaultModel };
  return { models, defaultModel };
}

/** Context window for a model id, from config when known, else the default. */
export function getGrokModelContextWindow(model: string): number {
  const { models } = readGrokConfiguredModels();
  const match = models.find((entry) => entry.id === model);
  return match?.contextWindow ?? DEFAULT_GROK_CONTEXT_WINDOW;
}

function getConfiguredEnvModel(settings: Record<string, unknown>): string | null {
  const modelId = getRuntimeEnvironmentVariables(settings, 'grok').GROK_MODEL?.trim();
  return modelId ? modelId : null;
}

/** Env-configured model id that is NOT one of the built-in defaults. */
export function getConfiguredEnvCustomModel(settings: Record<string, unknown>): string | null {
  const modelId = getConfiguredEnvModel(settings);
  return modelId && !DEFAULT_GROK_MODEL_SET.has(modelId) ? modelId : null;
}

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

function createCustomModelOption(modelId: string, description: string): ProviderUIOption {
  return { value: modelId, label: formatGrokModelLabel(modelId), description };
}

/**
 * Build the model dropdown: built-in defaults + config `[models.*]` + env
 * `GROK_MODEL` + user `customModels`, de-duplicated, defaults first.
 */
export function getGrokModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const models = [...DEFAULT_GROK_MODELS];
  const seen = new Set(models.map((model) => model.value));

  const { models: configuredModels } = readGrokConfiguredModels();
  for (const configured of configuredModels) {
    if (seen.has(configured.id)) {
      continue;
    }
    seen.add(configured.id);
    models.push({ value: configured.id, label: configured.label, description: 'Configured' });
  }

  const envModel = getConfiguredEnvCustomModel(settings);
  if (envModel && !seen.has(envModel)) {
    seen.add(envModel);
    models.unshift(createCustomModelOption(envModel, 'Custom (env)'));
  }

  const grokSettings = getGrokProviderSettings(settings);
  for (const modelId of parseConfiguredCustomModelIds(grokSettings.customModels)) {
    if (seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    models.push(createCustomModelOption(modelId, 'Custom model'));
  }

  return models;
}

/**
 * Resolve the active model: env override wins, then a still-valid current
 * selection, then config default, then the first option / built-in primary.
 */
export function resolveGrokModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const envModel = getConfiguredEnvModel(settings);
  if (envModel) {
    return envModel;
  }

  const modelOptions = getGrokModelOptions(settings);
  if (currentModel && modelOptions.some((option) => option.value === currentModel)) {
    return currentModel;
  }

  const { defaultModel } = readGrokConfiguredModels();
  if (defaultModel && modelOptions.some((option) => option.value === defaultModel)) {
    return defaultModel;
  }

  return modelOptions[0]?.value ?? DEFAULT_GROK_PRIMARY_MODEL;
}
