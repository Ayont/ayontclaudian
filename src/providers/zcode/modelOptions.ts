import type { ProviderUIOption } from '../../core/providers/types';
import { getZcodeProviderSettings } from './settings';
import {
  DEFAULT_ZCODE_CONTEXT_WINDOW,
  DEFAULT_ZCODE_MODELS,
  DEFAULT_ZCODE_PRIMARY_MODEL,
  formatZcodeModelLabel,
  ZCODE_GLM_5_TURBO_CONTEXT_WINDOW,
  ZCODE_GLM_5_TURBO_MODEL,
  ZCODE_GLM_53_CONTEXT_WINDOW,
  ZCODE_GLM_53_FLASH_CONTEXT_WINDOW,
  ZCODE_GLM_53_FLASH_MODEL,
  ZCODE_GLM_53_MODEL,
} from './types/models';

export function getZcodeModelContextWindow(model: string): number {
  const trimmed = model.trim().toLowerCase();
  if (trimmed === ZCODE_GLM_53_MODEL.toLowerCase() || trimmed === 'glm-5.3') {
    return ZCODE_GLM_53_CONTEXT_WINDOW;
  }
  if (trimmed === ZCODE_GLM_53_FLASH_MODEL.toLowerCase() || trimmed === 'glm-5.3-flash') {
    return ZCODE_GLM_53_FLASH_CONTEXT_WINDOW;
  }
  if (trimmed === ZCODE_GLM_5_TURBO_MODEL.toLowerCase() || trimmed === 'glm-5-turbo') {
    return ZCODE_GLM_5_TURBO_CONTEXT_WINDOW;
  }
  return DEFAULT_ZCODE_CONTEXT_WINDOW;
}

export function parseCustomModels(customModelsText: string): ProviderUIOption[] {
  if (!customModelsText.trim()) {
    return [];
  }
  return customModelsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(':');
      const value = parts[0].trim();
      const label = parts[1] ? parts[1].trim() : formatZcodeModelLabel(value);
      return {
        value,
        label,
        description: 'Benutzerdefiniertes Modell',
      };
    });
}

export function getZcodeModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
  const providerSettings = getZcodeProviderSettings(settings);
  const custom = parseCustomModels(providerSettings.customModels);
  const result: ProviderUIOption[] = [...DEFAULT_ZCODE_MODELS];

  for (const c of custom) {
    if (!result.some((r) => r.value.toLowerCase() === c.value.toLowerCase())) {
      result.push(c);
    }
  }

  return result;
}

export function resolveZcodeModelSelection(
  settings: Record<string, unknown>,
  requestedModel?: string,
): string {
  if (requestedModel && requestedModel.trim()) {
    return requestedModel.trim();
  }
  return DEFAULT_ZCODE_PRIMARY_MODEL;
}
