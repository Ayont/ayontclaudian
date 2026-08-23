import type {
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { HERMES_PROVIDER_ICON } from '../../../shared/icons';
import {
  decodeHermesModelId,
  describeHermesModel,
  encodeHermesModelId,
  HERMES_SYNTHETIC_MODEL_ID,
  type HermesDiscoveredModel,
  isHermesModelSelectionId,
} from '../models';
import {
  getEffectiveHermesModes,
  normalizeHermesSelectedMode,
  resolvePermissionModeForHermesMode,
} from '../modes';
import {
  getHermesProviderSettings,
  HERMES_PROVIDER_ID,
  updateHermesProviderSettings,
} from '../settings';

const HERMES_PLACEHOLDER_MODELS: ProviderUIOption[] = [
  {
    value: HERMES_SYNTHETIC_MODEL_ID,
    label: 'Hermes',
    description: 'Modelle werden beim ersten Start geladen',
  },
];

/**
 * Hermes routes through many inference providers with very different windows
 * and reports the real one per turn via `usage_update`. Until that arrives this
 * conservative default only sizes the badge; it never reaches the model.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000;

export const hermesChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const hermesSettings = getHermesProviderSettings(settings);
    const discoveredByRawId = new Map(
      hermesSettings.discoveredModels.map((model) => [model.rawId, model] as const),
    );

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    const pushModel = (rawId: string, fallbackDescription: string): void => {
      const value = encodeHermesModelId(rawId);
      if (!rawId || seenValues.has(value)) {
        return;
      }

      seenValues.add(value);
      options.push(buildModelOption(
        rawId,
        discoveredByRawId.get(rawId),
        hermesSettings.modelAliases[rawId],
        fallbackDescription,
      ));
    };

    for (const rawId of hermesSettings.visibleModels) {
      pushModel(rawId, 'Konfiguriertes Modell');
    }

    // The live session's model stays selectable even when it is hidden, so a
    // chat never shows a selector value that is not in its own list.
    for (const value of collectSelectedModelValues(settings)) {
      const rawId = decodeHermesModelId(value);
      if (rawId) {
        pushModel(rawId, 'In einer bestehenden Sitzung ausgewählt');
      }
    }

    return options.length > 0 ? options : [...HERMES_PLACEHOLDER_MODELS];
  },

  ownsModel(model: string): boolean {
    return isHermesModelSelectionId(model);
  },

  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  // Hermes' reasoning effort lives in ~/.hermes/config.yaml and has no ACP
  // channel, so Claudian does not pretend to control it.
  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isHermesModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const settingsBag = asSettingsBag(settings);
    const rawModelId = decodeHermesModelId(model);
    if (!settingsBag || !rawModelId) {
      return;
    }

    settingsBag.model = encodeHermesModelId(rawModelId);
  },

  normalizeModelVariant(model: string): string {
    const rawModelId = decodeHermesModelId(model);
    return rawModelId ? encodeHermesModelId(rawModelId) : model;
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(settings: Record<string, unknown>): ProviderModeSelectorConfig {
    const hermesSettings = getHermesProviderSettings(settings);
    const modes = getEffectiveHermesModes(hermesSettings.availableModes);
    return {
      label: 'Freigaben',
      options: modes.map((mode) => ({
        ...(mode.description ? { description: mode.description } : {}),
        label: mode.name,
        value: mode.id,
      })),
      value: normalizeHermesSelectedMode(hermesSettings.selectedMode, hermesSettings.availableModes),
    };
  },

  applyModeSelection(value: string, settings: unknown): void {
    const settingsBag = asSettingsBag(settings);
    if (!settingsBag) {
      return;
    }

    const hermesSettings = getHermesProviderSettings(settingsBag);
    const selectedMode = normalizeHermesSelectedMode(value, hermesSettings.availableModes);
    updateHermesProviderSettings(settingsBag, { selectedMode });

    const permissionMode = resolvePermissionModeForHermesMode(selectedMode);
    if (permissionMode) {
      settingsBag.permissionMode = permissionMode;
    }
  },

  // Hermes has no plan mode, so the shared Safe/YOLO/Plan toggle would offer a
  // control the agent cannot honour — the mode selector above is the real one.
  getPermissionModeToggle(): null {
    return null;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const hermesSettings = getHermesProviderSettings(settings);
    return resolvePermissionModeForHermesMode(
      normalizeHermesSelectedMode(hermesSettings.selectedMode, hermesSettings.availableModes),
    );
  },

  getProviderIcon() {
    return HERMES_PROVIDER_ICON;
  },
};

function buildModelOption(
  rawId: string,
  discovered: HermesDiscoveredModel | undefined,
  alias: string | undefined,
  fallbackDescription: string,
): ProviderUIOption {
  const model = discovered ?? { label: rawId, rawId };
  const { modelLabel, providerLabel } = describeHermesModel(model);
  return {
    description: discovered?.description ?? fallbackDescription,
    label: alias || (providerLabel ? `${providerLabel} · ${modelLabel}` : modelLabel),
    value: encodeHermesModelId(rawId),
  };
}

function collectSelectedModelValues(settings: Record<string, unknown>): string[] {
  const savedProviderModel = settings.savedProviderModel;
  const savedModel = savedProviderModel
    && typeof savedProviderModel === 'object'
    && !Array.isArray(savedProviderModel)
    ? (savedProviderModel as Record<string, unknown>)[HERMES_PROVIDER_ID]
    : undefined;

  return [settings.model, savedModel].filter(
    (value): value is string => typeof value === 'string'
      && isHermesModelSelectionId(value)
      && value !== HERMES_SYNTHETIC_MODEL_ID,
  );
}

function asSettingsBag(settings: unknown): Record<string, unknown> | null {
  return settings && typeof settings === 'object' && !Array.isArray(settings)
    ? settings as Record<string, unknown>
    : null;
}
