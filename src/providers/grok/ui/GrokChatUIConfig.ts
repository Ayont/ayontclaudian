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
} from '../types/models';

/** Thinking on/off, modeled as a two-option `'effort'` reasoning control. */
const GROK_THINKING_VALUE = 'thinking';
const GROK_NO_THINKING_VALUE = 'no-thinking';

const GROK_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: GROK_THINKING_VALUE, label: 'Thinking' },
  { value: GROK_NO_THINKING_VALUE, label: 'No thinking' },
];

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
    // Thinking is a binary toggle exposed as a two-option effort control.
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...GROK_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getGrokProviderSettings(settings).thinkingDefault
      ? GROK_THINKING_VALUE
      : GROK_NO_THINKING_VALUE;
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

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    updateGrokProviderSettings(bag, { thinkingDefault: value !== GROK_NO_THINKING_VALUE });
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
