import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { OMP_PROVIDER_ICON } from '../../../shared/icons';
import {
  buildOmpBaseModels,
  decodeOmpModelId,
  encodeOmpModelId,
  isOmpModelSelectionId,
  OMP_DEFAULT_THINKING_LEVEL,
  OMP_SYNTHETIC_MODEL_ID,
  resolveOmpBaseModelRawId,
} from '../models';
import {
  resolveOmpModeForPermissionMode,
  resolvePermissionModeForManagedOmpMode,
} from '../modes';
import { OmpChatRuntime } from '../runtime/OmpChatRuntime';
import { getOmpProviderSettings, updateOmpProviderSettings } from '../settings';

const OMP_MODELS: ProviderUIOption[] = [
  { value: OMP_SYNTHETIC_MODEL_ID, label: 'OMP', description: 'ACP runtime' },
];
const DEFAULT_CONTEXT_WINDOW = 200_000;
const OMP_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

export const ompChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings): ProviderUIOption[] {
    const ompSettings = getOmpProviderSettings(settings);
    const applyAlias = (rawId: string, option: ProviderUIOption): ProviderUIOption => {
      const alias = ompSettings.modelAliases[rawId];
      return alias ? { ...option, label: alias } : option;
    };
    const discoveredModels = new Map(buildOmpBaseModels(ompSettings.discoveredModels).map((model) => [
      encodeOmpModelId(model.rawId),
      applyAlias(model.rawId, {
        description: model.description ?? 'ACP runtime',
        label: model.label,
        value: encodeOmpModelId(model.rawId),
      }),
    ]));
    const savedProviderModel = (
      settings.savedProviderModel
      && typeof settings.savedProviderModel === 'object'
      && !Array.isArray(settings.savedProviderModel)
    )
      ? settings.savedProviderModel as Record<string, unknown>
      : null;

    const seenValues = new Set<string>();
    const options: ProviderUIOption[] = [];
    for (const rawModelId of ompSettings.visibleModels) {
      const encodedModelId = encodeOmpModelId(rawModelId);
      pushOption(
        options,
        seenValues,
        encodedModelId,
        discoveredModels.get(encodedModelId)
          ?? applyAlias(rawModelId, {
            description: 'Configured model',
            label: rawModelId,
            value: encodedModelId,
          }),
      );
    }

    const selectedModelValues = [
      typeof settings.model === 'string' ? settings.model : '',
      typeof savedProviderModel?.omp === 'string'
        ? savedProviderModel.omp
        : '',
    ];

    for (const model of selectedModelValues) {
      const rawModelId = decodeOmpModelId(model);
      if (
        !model
        || !isOmpModelSelectionId(model)
        || model === OMP_SYNTHETIC_MODEL_ID
        || !rawModelId
      ) {
        continue;
      }

      const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
      const baseModelId = encodeOmpModelId(baseRawId);
      pushOption(
        options,
        seenValues,
        baseModelId,
        discoveredModels.get(baseModelId)
          ?? applyAlias(baseRawId, {
            description: 'Selected in an existing session',
            label: baseRawId,
            value: baseModelId,
          }),
      );
    }

    return options.length > 0 ? options : [...OMP_MODELS];
  },

  ownsModel(model: string): boolean {
    return isOmpModelSelectionId(model);
  },

  isAdaptiveReasoningModel(model: string, settings: Record<string, unknown>): boolean {
    return getOmpThinkingOptions(model, settings).length > 0;
  },

  getReasoningOptions(model: string, settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getOmpThinkingOptions(model, settings)
      .map((variant) => ({
        description: variant.description,
        label: variant.label,
        value: variant.value,
      }));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeOmpModelId(model);
    if (!rawModelId) {
      return OMP_DEFAULT_THINKING_LEVEL;
    }

    const ompSettings = getOmpProviderSettings(settings);
    const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
    return getDefaultThinkingLevelForModel(baseRawId, settings);
  },

  getContextWindowSize(model: string, customLimits?: Record<string, number>): number {
    return customLimits?.[model] ?? DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return isOmpModelSelectionId(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeOmpModelId(model);
    if (!rawModelId) {
      settingsBag.effortLevel = OMP_DEFAULT_THINKING_LEVEL;
      return;
    }

    const ompSettings = getOmpProviderSettings(settingsBag);
    const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
    settingsBag.model = encodeOmpModelId(baseRawId);
    settingsBag.effortLevel = getDefaultThinkingLevelForModel(baseRawId, settingsBag);
  },

  async prepareModelMetadata(model: string, _settings: Record<string, unknown>, context): Promise<void> {
    const rawModelId = decodeOmpModelId(model);
    if (!rawModelId) {
      return;
    }

    const ompSettings = getOmpProviderSettings(context.plugin.settings);
    const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
    if (baseRawId && ompSettings.thinkingOptionsByModel[baseRawId]) {
      return;
    }

    const runtime = new OmpChatRuntime(context.plugin);
    try {
      runtime.syncConversationState({ providerState: {}, sessionId: null });
      await runtime.warmModelMetadata(model);
    } catch {
      // Metadata warmup is opportunistic; the first real turn can still discover it.
    } finally {
      runtime.cleanup();
    }
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    const rawModelId = decodeOmpModelId(model);
    if (!rawModelId) {
      return;
    }

    const ompSettings = getOmpProviderSettings(settingsBag);
    const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
    const supportedValues = new Set(
      (ompSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
    );
    const nextPreferredThinkingByModel = {
      ...ompSettings.preferredThinkingByModel,
    };

    if (!value || value === OMP_DEFAULT_THINKING_LEVEL || !supportedValues.has(value)) {
      delete nextPreferredThinkingByModel[baseRawId];
    } else {
      nextPreferredThinkingByModel[baseRawId] = value;
    }

    updateOmpProviderSettings(settingsBag, {
      preferredThinkingByModel: nextPreferredThinkingByModel,
    });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const rawModelId = decodeOmpModelId(model);
    if (!rawModelId) {
      return model;
    }

    const ompSettings = getOmpProviderSettings(settings);
    const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
    return encodeOmpModelId(baseRawId);
  },

  getCustomModelIds(): Set<string> {
    return new Set<string>();
  },

  getModeSelector(): null {
    return null;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return OMP_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    const selectedMode = getOmpProviderSettings(settings).selectedMode;
    return resolvePermissionModeForManagedOmpMode(selectedMode);
  },

  applyPermissionMode(value: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }

    const settingsBag = settings as Record<string, unknown>;
    settingsBag.permissionMode = value;
    updateOmpProviderSettings(settingsBag, {
      selectedMode: resolveOmpModeForPermissionMode(
        value,
        getOmpProviderSettings(settingsBag).availableModes,
      ),
    });
  },

  getProviderIcon() {
    return OMP_PROVIDER_ICON;
  },
};

function getDefaultThinkingLevelForModel(
  baseRawId: string,
  settings: Record<string, unknown>,
): string {
  const ompSettings = getOmpProviderSettings(settings);
  const preferred = ompSettings.preferredThinkingByModel[baseRawId];
  const supportedValues = new Set(
    (ompSettings.thinkingOptionsByModel[baseRawId] ?? []).map((variant) => variant.value),
  );
  if (preferred && supportedValues.has(preferred)) {
    return preferred;
  }

  return ompSettings.thinkingOptionsByModel[baseRawId]?.[0]?.value
    ?? OMP_DEFAULT_THINKING_LEVEL;
}

function getOmpThinkingOptions(
  model: string,
  settings: Record<string, unknown>,
): ProviderReasoningOption[] {
  const rawModelId = decodeOmpModelId(model);
  if (!rawModelId) {
    return [];
  }

  const ompSettings = getOmpProviderSettings(settings);
  const baseRawId = resolveOmpBaseModelRawId(rawModelId, ompSettings.discoveredModels);
  return ompSettings.thinkingOptionsByModel[baseRawId] ?? [];
}

function pushOption(
  target: ProviderUIOption[],
  seenValues: Set<string>,
  value: string,
  option: ProviderUIOption,
): void {
  if (seenValues.has(value)) {
    return;
  }

  seenValues.add(value);
  target.push(option);
}
