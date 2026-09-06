import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * ZCode (Z.ai Coding Plan) model catalog.
 *
 * Models:
 * - GLM-5.3: Flagship coding & reasoning model (1M context, 128K output)
 * - GLM-5.3-Flash: Fast multimodal model (1M context, 128K output)
 * - GLM-5-Turbo: High-throughput model (200K context, 128K output)
 */
export type ZcodeModel = string;

export const DEFAULT_ZCODE_PRIMARY_MODEL: ZcodeModel = 'GLM-5.3';
export const DEFAULT_ZCODE_CONTEXT_WINDOW = 1_000_000;

export const ZCODE_GLM_53_MODEL: ZcodeModel = 'GLM-5.3';
export const ZCODE_GLM_53_CONTEXT_WINDOW = 1_000_000;

export const ZCODE_GLM_53_FLASH_MODEL: ZcodeModel = 'GLM-5.3-Flash';
export const ZCODE_GLM_53_FLASH_CONTEXT_WINDOW = 1_000_000;

export const ZCODE_GLM_5_TURBO_MODEL: ZcodeModel = 'GLM-5-Turbo';
export const ZCODE_GLM_5_TURBO_CONTEXT_WINDOW = 200_000;

export function formatZcodeModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'GLM-5.3';
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'glm-5.3') {
    return 'GLM-5.3 (Flaggschiff)';
  }
  if (lower === 'glm-5.3-flash') {
    return 'GLM-5.3 Flash (Multimodal)';
  }
  if (lower === 'glm-5-turbo') {
    return 'GLM-5 Turbo';
  }
  return trimmed;
}

export const DEFAULT_ZCODE_MODELS: ProviderUIOption[] = [
  {
    value: ZCODE_GLM_53_MODEL,
    label: 'GLM-5.3 (Flaggschiff)',
    description: '1M Kontext · 128K Output · Reasoning (low / high / max)',
  },
  {
    value: ZCODE_GLM_53_FLASH_MODEL,
    label: 'GLM-5.3 Flash',
    description: '1M Kontext · Multimodal (Bilder & Text) · Ultraschnell',
  },
  {
    value: ZCODE_GLM_5_TURBO_MODEL,
    label: 'GLM-5 Turbo',
    description: '200K Kontext · 128K Output · Schnell & kompakt',
  },
];
