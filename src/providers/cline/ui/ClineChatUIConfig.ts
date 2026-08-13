import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderUIOption,
} from '../../../core/providers/types';
import { CLINE_PROVIDER_ICON } from '../../../shared/icons';
import { getClineModelContextWindow, getClineModelOptions } from '../modelOptions';
import {
  applyClineModelDefaults,
  getClineProviderSettings,
  updateClineProviderSettings,
} from '../settings';
import {
  DEFAULT_CLINE_CONTEXT_WINDOW,
  DEFAULT_CLINE_MODEL_SET,
  DEFAULT_CLINE_PRIMARY_MODEL,
  isClineThinkingLevel,
} from '../types/models';

const CLINE_REASONING_OPTIONS: ProviderReasoningOption[] = [
  { value: 'none', label: 'Kein Thinking' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
];

const CLINE_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
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

export const clineChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getClineModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getClineModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }
    return DEFAULT_CLINE_MODEL_SET.has(model)
      || model.startsWith('cline-pass/')
      || model.startsWith('cline/');
  },

  isAdaptiveReasoningModel(): boolean {
    return true;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [...CLINE_REASONING_OPTIONS];
  },

  getDefaultReasoningValue(_model: string, settings: Record<string, unknown>): string {
    return getClineProviderSettings(settings).thinking;
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    return customLimits?.[model] ?? getClineModelContextWindow(model) ?? DEFAULT_CLINE_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_CLINE_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (bag) {
      applyClineModelDefaults(model, bag);
    }
  },

  applyReasoningSelection(_model: string, value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag || !isClineThinkingLevel(value)) {
      return;
    }
    updateClineProviderSettings(bag, { thinking: value });
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getClineModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }
    return DEFAULT_CLINE_PRIMARY_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const envModel = envVars.CLINE_MODEL?.trim();
    if (envModel && !DEFAULT_CLINE_MODEL_SET.has(envModel)) {
      ids.add(envModel);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CLINE_PERMISSION_MODE_TOGGLE;
  },

  resolvePermissionMode(settings: Record<string, unknown>): string | null {
    return getClineProviderSettings(settings).permissionMode;
  },

  applyPermissionMode(value: string, settings: unknown): void {
    const bag = asSettingsBag(settings);
    if (!bag) {
      return;
    }
    const mode = value === 'yolo' || value === 'plan' ? value : 'normal';
    updateClineProviderSettings(bag, { permissionMode: mode });
  },

  getProviderIcon() {
    return CLINE_PROVIDER_ICON;
  },
};
