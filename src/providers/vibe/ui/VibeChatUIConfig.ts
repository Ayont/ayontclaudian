import type {
  ProviderChatUIConfig,
  ProviderModeSelectorConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { VIBE_PROVIDER_ICON } from '../../../shared/icons';
import { getVibeModelContextWindow, getVibeModelOptions } from '../modelOptions';
import { applyVibeModelDefaults, getVibeProviderSettings, updateVibeProviderSettings } from '../settings';
import {
  DEFAULT_VIBE_CONTEXT_WINDOW,
  DEFAULT_VIBE_MODEL_SET,
  DEFAULT_VIBE_PRIMARY_MODEL,
} from '../types/models';

/** Thinking on/off, modeled as a two-option `'effort'` reasoning control. */
const VIBE_THINKING_VALUE = 'thinking';
const VIBE_NO_THINKING_VALUE = 'no-thinking';

const VIBE_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: VIBE_THINKING_VALUE, label: 'Thinking' },
  { value: VIBE_NO_THINKING_VALUE, label: 'No thinking' },
];

const VIBE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const VIBE_AGENT_OPTIONS: ProviderUIOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'okabe', label: 'Okabe' },
];

function asSettingsBag(settings: unknown): Record<string, unknown> | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return null;
  }
  return settings as Record<string, unknown>;
}

export const vibeChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getVibeModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getVibeModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }
    return DEFAULT_VIBE_MODEL_SET.has(model) || model.startsWith('vibe');
  },

  isAdaptiveReasoningModel(): boolean {
    // Thinking is a binary toggle exposed as a two-option effort control.
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...VIBE_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getVibeProviderSettings(settings).thinkingDefault
      ? VIBE_THINKING_VALUE
      : VIBE_NO_THINKING_VALUE;
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    return customLimits?.[model] ?? getVibeModelContextWindow(model) ?? DEFAULT_VIBE_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_VIBE_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (bag) {
      applyVibeModelDefaults(model, bag);
    }
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    updateVibeProviderSettings(bag, { thinkingDefault: value !== VIBE_NO_THINKING_VALUE });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getVibeModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return DEFAULT_VIBE_PRIMARY_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const envModel = envVars.VIBE_MODEL?.trim();
    if (envModel && !DEFAULT_VIBE_MODEL_SET.has(envModel)) {
      ids.add(envModel);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return VIBE_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getVibeProviderSettings(settings).permissionMode;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const mode = value === 'yolo' || value === 'plan' ? value : 'normal';
    bag.permissionMode = mode;
    updateVibeProviderSettings(bag, { permissionMode: mode });
  },

  getModeSelector(settings: Record<string, unknown>): ProviderModeSelectorConfig {
    return {
      label: 'Agent',
      options: [...VIBE_AGENT_OPTIONS],
      value: getVibeProviderSettings(settings).agent,
    };
  },

  applyModeSelection(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    updateVibeProviderSettings(bag, { agent: value === 'okabe' ? 'okabe' : 'default' });
  },

  getProviderIcon() {
    return VIBE_PROVIDER_ICON;
  },
};
