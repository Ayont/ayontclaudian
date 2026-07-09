import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import { OPENAI_PROVIDER_ICON } from '../../../shared/icons';
import { getCodexModelOptions } from '../modelOptions';
import { applyCodexModelDefaults } from '../settings';
import {
  DEFAULT_CODEX_CONTEXT_WINDOW,
  DEFAULT_CODEX_MODEL_SET,
  DEFAULT_CODEX_PRIMARY_MODEL,
  FAST_TIER_CODEX_DESCRIPTION,
  getCodexModelContextWindow,
  supportsCodexFastTier,
  supportsCodexMaxEffort,
  supportsCodexUltraEffort,
} from '../types/models';

const BASE_EFFORT_LEVELS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

const MAX_EFFORT_LEVEL: ProviderReasoningOption = { value: 'max', label: 'Max' };
const ULTRA_EFFORT_LEVEL: ProviderReasoningOption = { value: 'ultra', label: 'Ultra' };

const CODEX_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const CODEX_SERVICE_TIER_TOGGLE: ProviderServiceTierToggleConfig = {
  inactiveValue: 'default',
  inactiveLabel: 'Standard',
  activeValue: 'fast',
  activeLabel: 'Fast',
  description: FAST_TIER_CODEX_DESCRIPTION,
};

function looksLikeCodexModel(model: string): boolean {
  return /^gpt-/i.test(model) || /^o\d/i.test(model);
}

export const codexChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getCodexModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getCodexModelOptions(settings).some((option: ProviderUIOption) => option.value === model)) {
      return true;
    }

    return looksLikeCodexModel(model);
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(model: string, _settings: Record<string, unknown>): ProviderReasoningOption[] {
    const options = [...BASE_EFFORT_LEVELS];
    if (supportsCodexMaxEffort(model)) {
      options.push(MAX_EFFORT_LEVEL);
    }
    if (supportsCodexUltraEffort(model)) {
      options.push(ULTRA_EFFORT_LEVEL);
    }
    return options;
  },

  getDefaultReasoningValue(_model: string, _settings: Record<string, unknown>): string {
    return 'medium';
  },

  getContextWindowSize(model: string): number {
    return model ? getCodexModelContextWindow(model) : DEFAULT_CODEX_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_CODEX_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object') {
      return;
    }

    applyCodexModelDefaults(model, settings as Record<string, unknown>);
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    if (getCodexModelOptions(settings).some((option) => option.value === model)) {
      return model;
    }

    return DEFAULT_CODEX_PRIMARY_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.OPENAI_MODEL && !DEFAULT_CODEX_MODEL_SET.has(envVars.OPENAI_MODEL)) {
      ids.add(envVars.OPENAI_MODEL);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CODEX_PERMISSION_MODE_TOGGLE;
  },

  getServiceTierToggle(settings): ProviderServiceTierToggleConfig | null {
    return supportsCodexFastTier(typeof settings.model === 'string' ? settings.model : undefined)
      ? CODEX_SERVICE_TIER_TOGGLE
      : null;
  },

  getProviderIcon() {
    return OPENAI_PROVIDER_ICON;
  },
};
