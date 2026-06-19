import * as fs from 'node:fs';

import { parse as parseToml } from 'smol-toml';

import { getRuntimeEnvironmentVariables } from '../../core/providers/providerEnvironment';
import type { ProviderUIOption } from '../../core/providers/types';
import { getKimiConfigPath, getKimiConfigPaths } from './history/KimiSessionStore';
import { getKimiProviderSettings } from './settings';
import {
  DEFAULT_KIMI_CONTEXT_WINDOW,
  DEFAULT_KIMI_MODEL_SET,
  DEFAULT_KIMI_MODELS,
  DEFAULT_KIMI_PRIMARY_MODEL,
  formatKimiModelLabel,
  KNOWN_KIMI_MODELS,
} from './types/models';

/** A model discovered from `~/.kimi/config.toml` `[models.*]`. */
export interface KimiConfiguredModel {
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
    : DEFAULT_KIMI_CONTEXT_WINDOW;
}

/**
 * Reads `[models.*]` tables and `default_model` from `~/.kimi/config.toml`.
 *
 * Never throws: a missing or malformed config yields an empty list, and the
 * built-in default model carries the dropdown on its own.
 */
export function readKimiConfiguredModels(): {
  models: KimiConfiguredModel[];
  defaultModel: string | null;
} {
  const models: KimiConfiguredModel[] = [];
  const seen = new Set<string>();
  let defaultModel: string | null = null;

  // Scan every known config location (modern `~/.kimi-code/`, legacy `~/.kimi/`)
  // and merge their `[models.*]` tables. The first file that names a
  // `default_model` wins. Missing or malformed files are skipped silently.
  for (const configPath of getKimiConfigPaths()) {
    let raw: string;
    try {
      raw = fs.readFileSync(configPath, 'utf-8');
    } catch {
      continue;
    }

    let parsed: Record<string, unknown> | null;
    try {
      parsed = toRecord(parseToml(raw));
    } catch {
      continue;
    }
    if (!parsed) {
      continue;
    }

    const modelsTable = toRecord(parsed.models);
    if (modelsTable) {
      for (const [id, entry] of Object.entries(modelsTable)) {
        if (seen.has(id)) {
          continue;
        }
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        const displayName = typeof record.display_name === 'string' ? record.display_name.trim() : '';
        seen.add(id);
        models.push({
          id,
          label: displayName ? `Kimi · ${displayName}` : formatKimiModelLabel(id),
          contextWindow: toContextWindow(record.max_context_size),
        });
      }
    }

    if (!defaultModel) {
      const candidate = typeof parsed.default_model === 'string' && parsed.default_model.trim()
        ? parsed.default_model.trim()
        : null;
      if (candidate) {
        defaultModel = candidate;
      }
    }
  }

  return { models, defaultModel };
}

/** Context window for a model id, from config when known, else the default. */
export function getKimiModelContextWindow(model: string): number {
  const { models } = readKimiConfiguredModels();
  const match = models.find((entry) => entry.id === model);
  return match?.contextWindow ?? DEFAULT_KIMI_CONTEXT_WINDOW;
}

/**
 * Best-effort human display name for a known or configured Kimi model id.
 */
function getKimiModelDisplayName(modelId: string): string {
  const known = KNOWN_KIMI_MODELS.find((m) => m.value === modelId);
  if (known) {
    return known.label.replace(/^Kimi · /, '');
  }
  const tail = modelId.includes('/') ? modelId.slice(modelId.lastIndexOf('/') + 1) : modelId;
  return tail
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Ensures a model id exists in `~/.kimi/config.toml` `[models.*]`.
 * Kimi CLI requires every `-m` value to be declared in config.toml with
 * `max_context_size`. If the model is missing, append a minimal section.
 * Returns true when the config was modified.
 */
export function ensureKimiModelConfigured(modelId: string): boolean {
  if (!modelId || DEFAULT_KIMI_MODEL_SET.has(modelId)) {
    return false;
  }

  const configPath = getKimiConfigPath();
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    raw = '';
  }

  const escapedId = modelId.replace(/"/g, '\\"');
  const quotedPattern = new RegExp(`\\[models\\."${escapedId}"\\]`, 'i');
  const barePattern = new RegExp(`\\[models\\.${escapedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i');
  if (quotedPattern.test(raw) || barePattern.test(raw)) {
    return false;
  }

  const section = `\n[models."${escapedId}"]\ndisplay_name = "${getKimiModelDisplayName(modelId)}"\nmax_context_size = ${DEFAULT_KIMI_CONTEXT_WINDOW}\n`;
  const updated = raw.trimEnd() + section;
  try {
    fs.writeFileSync(configPath, updated, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

function getConfiguredEnvModel(settings: Record<string, unknown>): string | null {
  const modelId = getRuntimeEnvironmentVariables(settings, 'kimi').KIMI_MODEL?.trim();
  return modelId ? modelId : null;
}

/** Env-configured model id that is NOT one of the built-in defaults. */
export function getConfiguredEnvCustomModel(settings: Record<string, unknown>): string | null {
  const modelId = getConfiguredEnvModel(settings);
  return modelId && !DEFAULT_KIMI_MODEL_SET.has(modelId) ? modelId : null;
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
  return { value: modelId, label: formatKimiModelLabel(modelId), description };
}

/**
 * Build the model dropdown: built-in defaults + config `[models.*]` + env
 * `KIMI_MODEL` + user `customModels`, de-duplicated, defaults first.
 */
export function getKimiModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const models = [...DEFAULT_KIMI_MODELS];
  const seen = new Set(models.map((model) => model.value));

  for (const configured of readKimiConfiguredModels().models) {
    if (seen.has(configured.id)) {
      continue;
    }
    seen.add(configured.id);
    models.push({ value: configured.id, label: configured.label, description: 'Configured' });
  }

  // Only offer documented catalog models when they are actually configured in
  // ~/.kimi/config.toml. Kimi CLI rejects `-m <model>` if the model is missing
  // from config.toml, so surfacing unconfigured ids leads to runtime errors.
  const configuredIds = new Set(readKimiConfiguredModels().models.map((m) => m.id));
  for (const known of KNOWN_KIMI_MODELS) {
    if (seen.has(known.value) || !configuredIds.has(known.value)) {
      continue;
    }
    seen.add(known.value);
    models.push(known);
  }

  const envModel = getConfiguredEnvCustomModel(settings);
  if (envModel && !seen.has(envModel)) {
    seen.add(envModel);
    models.unshift(createCustomModelOption(envModel, 'Custom (env)'));
  }

  const kimiSettings = getKimiProviderSettings(settings);
  for (const modelId of parseConfiguredCustomModelIds(kimiSettings.customModels)) {
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
export function resolveKimiModelSelection(
  settings: Record<string, unknown>,
  currentModel: string,
): string | null {
  const envModel = getConfiguredEnvModel(settings);
  if (envModel) {
    return envModel;
  }

  const modelOptions = getKimiModelOptions(settings);
  if (currentModel && modelOptions.some((option) => option.value === currentModel)) {
    return currentModel;
  }

  const { defaultModel } = readKimiConfiguredModels();
  if (defaultModel && modelOptions.some((option) => option.value === defaultModel)) {
    return defaultModel;
  }

  return modelOptions[0]?.value ?? DEFAULT_KIMI_PRIMARY_MODEL;
}
