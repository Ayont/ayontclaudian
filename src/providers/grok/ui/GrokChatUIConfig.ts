import type {
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { GROK_PROVIDER_ICON } from '../../../shared/icons';
import { getGrokModelContextWindow, getGrokModelOptions } from '../modelOptions';
import { applyGrokModelDefaults, getGrokProviderSettings, updateGrokProviderSettings } from '../settings';
import {
  DEFAULT_GROK_CONTEXT_WINDOW,
  DEFAULT_GROK_MODEL_SET,
  DEFAULT_GROK_PRIMARY_MODEL,
  getGrokReasoningEfforts,
  GROK_DEFAULT_REASONING_EFFORT,
  grokReasoningOption,
  normalizeGrokReasoningEffort,
} from '../types/models';

const GROK_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const GROK_AGENT_OPTIONS: ProviderUIOption[] = [
  { value: 'default', label: 'Default' },
];

function asSettingsBag(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  return settings as Record<string, unknown>;
}

export const grokChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getGrokModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getGrokModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }
    return DEFAULT_GROK_MODEL_SET.has(model) || model.startsWith('grok');
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(model: string): ProviderReasoningOption[] {
    return getGrokReasoningEfforts(model).map((effort) => grokReasoningOption(effort));
  },

  getDefaultReasoningValue(model: string, settings: Record<string, unknown>): string {
    const live = typeof settings.effortLevel === 'string' ? settings.effortLevel : '';
    const normalized = normalizeGrokReasoningEffort(live, model);
    if (normalized) {
      return normalized;
    }
    const legacy = getGrokProviderSettings(settings).thinkingDefault
      ? GROK_DEFAULT_REASONING_EFFORT
      : 'low';
    return normalizeGrokReasoningEffort(legacy, model) ?? GROK_DEFAULT_REASONING_EFFORT;
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    return customLimits?.[model] ?? getGrokModelContextWindow(model) ?? DEFAULT_GROK_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_GROK_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (bag) {
      applyGrokModelDefaults(model, bag);
    }
  },

  applyReasoningSelection(model: string, value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const effort = normalizeGrokReasoningEffort(value, model) ?? GROK_DEFAULT_REASONING_EFFORT;
    bag.effortLevel = effort;
    // Coarse legacy mirror: only "Niedrig" maps back to the old off switch.
    updateGrokProviderSettings(bag, { thinkingDefault: effort !== 'low' });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getGrokModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return DEFAULT_GROK_PRIMARY_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const envModel = envVars.GROK_MODEL?.trim();
    if (envModel && !DEFAULT_GROK_MODEL_SET.has(envModel)) {
      ids.add(envModel);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return GROK_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getGrokProviderSettings(settings).permissionMode;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const mode = value === 'yolo' || value === 'plan' ? value : 'normal';
    bag.permissionMode = mode;
    updateGrokProviderSettings(bag, { permissionMode: mode });
  },

  getModeSelector(settings: Record<string, unknown>): ProviderModeSelectorConfig {
    return {
      label: 'Agent',
      options: [...GROK_AGENT_OPTIONS],
      value: getGrokProviderSettings(settings).agent,
    };
  },

  applyModeSelection(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    updateGrokProviderSettings(bag, { agent: 'default' });
  },

  getProviderIcon() {
    return GROK_PROVIDER_ICON;
  },
};
