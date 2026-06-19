import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Grok (xAI) model catalog.
 *
 * The Grok CLI selects the model with `-m`/`--model` (value is a model id, or a
 * custom id from `~/.grok/config.toml`). The default `grok-build` powers the
 * CLI; reasoning and multi-agent variants are also available. We seed the
 * dropdown with these and merge any extra ids discovered from the user's config
 * via `modelOptions.ts`.
 */
export type GrokModel = string;

/** Default `-m` value (the model that powers the Grok Build CLI). */
export const DEFAULT_GROK_PRIMARY_MODEL: GrokModel = 'grok-build-0.1';

/** Display label for the default model. */
const DEFAULT_GROK_PRIMARY_MODEL_LABEL = 'Grok Build 0.1';

/** Grok context window (256K). */
export const DEFAULT_GROK_CONTEXT_WINDOW = 256_000;

/** Best-effort human label for a Grok model id (e.g. `grok-code-fast-1` → `Grok Code Fast 1`). */
export function formatGrokModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Grok';
  }
  const words = trimmed
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(' ') : trimmed;
}

function createGrokModelOption(model: GrokModel, label: string, description: string): ProviderUIOption {
  return { value: model, label, description };
}

/** Built-in default model options shown before any user/config additions. */
export const DEFAULT_GROK_MODELS: ProviderUIOption[] = [
  createGrokModelOption(DEFAULT_GROK_PRIMARY_MODEL, DEFAULT_GROK_PRIMARY_MODEL_LABEL, 'Standard CLI-Modell'),
  createGrokModelOption('grok-code-fast-1', 'Grok Code Fast', 'Schnelles Coding-Modell'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_GROK_MODEL_SET = new Set<string>(DEFAULT_GROK_MODELS.map((model) => model.value));
