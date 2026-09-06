import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { ZCODE_PROVIDER_ICON } from '../../../shared/icons';
import { getZcodeModelContextWindow, getZcodeModelOptions } from '../modelOptions';
import {
  getZcodeProviderSettings,
  updateZcodeProviderSettings,
  type ZcodePermissionMode,
  type ZcodeReasoningEffort,
} from '../settings';
import {
  DEFAULT_ZCODE_CONTEXT_WINDOW,
  DEFAULT_ZCODE_MODELS,
  DEFAULT_ZCODE_PRIMARY_MODEL,
} from '../types/models';

const ZCODE_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'max', label: 'Max (32K)' },
  { value: 'high', label: 'High (16K)' },
  { value: 'low', label: 'Low (4K)' },
  { value: 'off', label: 'Off' },
];

const ZCODE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

function asSettingsBag(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  return settings as Record<string, unknown>;
}

export const zcodeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getZcodeModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getZcodeModelOptions(settings).some((opt) => opt.value === model)) {
      return true;
    }
    const lower = model.toLowerCase();
    return lower.startsWith('glm') || lower.startsWith('zcode');
  },

  isAdaptiveReasoningModel(model: string): boolean {
    const lower = model.toLowerCase();
    return !lower.includes('flash');
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...ZCODE_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getZcodeProviderSettings(settings).reasoningEffort;
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    return customLimits?.[model] ?? getZcodeModelContextWindow(model) ?? DEFAULT_ZCODE_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return (
      model === DEFAULT_ZCODE_PRIMARY_MODEL ||
      DEFAULT_ZCODE_MODELS.some((m) => m.value === model)
    );
  },

  applyModelDefaults(_model: string, _settings: unknown): void {},

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const effort: ZcodeReasoningEffort =
      value === 'low' || value === 'high' || value === 'max' || value === 'off'
        ? value
        : 'max';
    updateZcodeProviderSettings(bag, (current) => ({
      ...current,
      reasoningEffort: effort,
    }));
  },

  normalizeModelVariant(model: string, _settings: Record<string, unknown>): string {
    return model;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const envModel = envVars.ZCODE_MODEL?.trim() || envVars.GLM_MODEL?.trim();
    if (envModel && !DEFAULT_ZCODE_MODELS.some((m) => m.value.toLowerCase() === envModel.toLowerCase())) {
      ids.add(envModel);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return ZCODE_PERMISSION_MODE_TOGGLE;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const mode: ZcodePermissionMode =
      value === 'yolo' || value === 'plan' ? value : 'normal';
    updateZcodeProviderSettings(bag, (current) => ({
      ...current,
      permissionMode: mode,
    }));
  },

  getProviderIcon() {
    return ZCODE_PROVIDER_ICON;
  },
};
