import type { ProviderChatUIConfig, ProviderReasoningOption, ProviderUIOption } from '../../../core/providers/types';
import { FREEBUFF_PROVIDER_ICON } from '../../../shared/icons';
import { getFreebuffModelOptions } from '../modelOptions';
import { DEFAULT_FREEBUFF_CONTEXT_WINDOW, DEFAULT_FREEBUFF_MODEL_SET, FREEBUFF_MODEL_CATALOG, getFreebuffModelContextWindow } from '../types/models';

export const freebuffChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getFreebuffModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (getFreebuffModelOptions(settings).some((option) => option.value === model)) {
      return true;
    }
    return DEFAULT_FREEBUFF_MODEL_SET.has(model) || model.startsWith('freebuff');
  },

  // No reasoning surface: the harness catalog exposes no effort control the
  // plugin can set per thread today.
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
    return customLimits?.[model] ?? getFreebuffModelContextWindow(model) ?? DEFAULT_FREEBUFF_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_FREEBUFF_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return;
    }
    const bag = settings as Record<string, unknown>;
    if (DEFAULT_FREEBUFF_MODEL_SET.has(model)) {
      bag.model = model;
    }
  },

  normalizeModelVariant(model: string, _settings: Record<string, unknown>): string {
    const entry = FREEBUFF_MODEL_CATALOG.find((candidate) => candidate.id === model);
    return entry ? entry.id : model;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    void envVars;
    return new Set<string>();
  },

  getProviderIcon() {
    return FREEBUFF_PROVIDER_ICON;
  },
};