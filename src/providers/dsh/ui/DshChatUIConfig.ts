import type { ProviderChatUIConfig, ProviderReasoningOption, ProviderUIOption } from '../../../core/providers/types';
import { DSH_PROVIDER_ICON } from '../../../shared/icons';
import { getDshModelContextWindow, getDshModelOptions } from '../modelOptions';
import { applyDshModelDefaults } from '../settings';
import { DEFAULT_DSH_CONTEXT_WINDOW, DEFAULT_DSH_MODEL,DEFAULT_DSH_MODEL_SET } from '../types/models';

export const dshChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getDshModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getDshModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }
    return DEFAULT_DSH_MODEL_SET.has(model) || model.startsWith('dsh');
  },

  // No reasoning surface: the headless profile has no thinking/effort control.
  isAdaptiveReasoningModel(): boolean {
    return false;
  },

  getReasoningOptions(): ProviderReasoningOption[] {
    return [];
  },

  getDefaultReasoningValue(): string {
    return '';
  },

  getContextWindowSize(
    model: string,
    customLimits?: Record<string, number>,
    _settings?: Record<string, unknown>,
  ): number {
    return customLimits?.[model] ?? getDshModelContextWindow(model) ?? DEFAULT_DSH_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_DSH_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      applyDshModelDefaults(model, settings as Record<string, unknown>);
    }
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    // Keep a configured harness selection instead of collapsing it to 'default'.
    if (this.ownsModel(model, settings)) {
      return model;
    }
    return DEFAULT_DSH_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    const envModel = envVars.DSH_MODEL?.trim();
    if (envModel && !DEFAULT_DSH_MODEL_SET.has(envModel)) {
      ids.add(envModel);
    }
    return ids;
  },

  getProviderIcon() {
    return DSH_PROVIDER_ICON;
  },
};
