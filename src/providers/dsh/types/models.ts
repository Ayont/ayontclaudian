import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * DeepSeek Harness model catalog.
 *
 * The headless profile exposes NO model flag (verified against the real CLI);
 * every run uses agent-default-model.currentSelection() from the harness's
 * own ~/.dsh/settings.yaml. A --patch overlay targeting agent-default-model
 * was probed and did NOT reach model selection (bogus provider still exited
 * 0), so the dropdown intentionally carries ONE honest entry instead of fake
 * per-model switching.
 */
export type DshModel = string;

/** The single built-in model id shown in the picker. */
export const DEFAULT_DSH_MODEL: DshModel = 'default';

/**
 * Fallback context window. The harness's own DeepSeek adapter ships
 * DEFAULT_CONTEXT_WINDOW = 1e6 (@deepseek-ai/dsh-llm-deepseek), which is the
 * authoritative figure for what dsh actually serves.
 */
export const DEFAULT_DSH_CONTEXT_WINDOW = 1_000_000;

/** Best-effort human label for a hand-typed/custom model id. */
export function formatDshModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed === DEFAULT_DSH_MODEL) {
    return 'DeepSeek Harness';
  }
  return trimmed;
}

/** Built-in model options shown before any user additions. */
export const DEFAULT_DSH_MODELS: ProviderUIOption[] = [
  {
    value: DEFAULT_DSH_MODEL,
    label: 'DeepSeek Harness',
    description: 'Folgt agent-default-model in ~/.dsh/settings.yaml · 1M Kontext',
  },
];

/** Fast lookup for whether a model id is the built-in default. */
export const DEFAULT_DSH_MODEL_SET = new Set<string>(DEFAULT_DSH_MODELS.map((model) => model.value));
