import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Freebuff model catalog (harnessId "codebuff").
 *
 * Ids verified against the desktop orchestrator bundle
 * (SUPPORTED_FREEBUFF_MODELS, Freebuff.app 0.0.154); the default follows the
 * CLI's documented default. Context windows: only ONE figure is verified —
 * the finish event of a live turn reported compactionThresholdTokens=400000
 * on the default model. That observed threshold is used as the estimate for
 * every entry instead of inventing per-model numbers; usage percentages are
 * therefore approximate by design until per-model figures are measured.
 */
export type FreebuffModel = string;

/** Documented CLI/UI default (DeepSeek V4 Flash 07/31). */
export const DEFAULT_FREEBUFF_MODEL: FreebuffModel = 'deepseek/deepseek-v4-flash';

/** Observed compaction threshold from a live turn's finish event. */
export const DEFAULT_FREEBUFF_CONTEXT_WINDOW = 400_000;

interface FreebuffCatalogEntry {
  readonly id: FreebuffModel;
  readonly label: string;
  readonly description: string;
  /** Premium models draw on limited daily sessions (README-verified caps). */
  readonly premium?: boolean;
}

export const FREEBUFF_MODEL_CATALOG: readonly FreebuffCatalogEntry[] = Object.freeze([
  {
    id: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'Standard-Modell · große tägliche Kontingente',
  },
  {
    id: 'openai/gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Premium · ca. 2 Sitzungen/Tag, fällt auf MiMo zurück',
    premium: true,
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Premium · ca. 1 Sitzung/Tag',
    premium: true,
  },
  {
    id: 'mimo/mimo-v2.5',
    label: 'MiMo 2.5',
    description: 'Fallback-Modell mit eigenen Tageskontingenten',
  },
]);

/** Built-in picker options derived from the catalog. */
export const DEFAULT_FREEBUFF_MODELS: ProviderUIOption[] = FREEBUFF_MODEL_CATALOG.map((entry) => ({
  value: entry.id,
  label: entry.label,
  description: entry.description,
}));

export const DEFAULT_FREEBUFF_MODEL_SET = new Set<string>(FREEBUFF_MODEL_CATALOG.map((entry) => entry.id));

/** True when the id is in the verified harness catalog. */
export function isKnownFreebuffModel(model: string): boolean {
  return DEFAULT_FREEBUFF_MODEL_SET.has(model.trim());
}

export function getFreebuffModelContextWindow(_model: string): number {
  return DEFAULT_FREEBUFF_CONTEXT_WINDOW;
}

export function formatFreebuffModelLabel(model: string): string {
  const entry = FREEBUFF_MODEL_CATALOG.find((candidate) => candidate.id === model.trim());
  return entry ? entry.label : model.trim() || 'Freebuff';
}