import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Vibe (Mistral) model catalog.
 *
 * Vibe selects the model via the `VIBE_ACTIVE_MODEL` env var (or `active_model`
 * in `~/.vibe/config.toml`). The value is a model `name` or `alias` from the
 * `[[models]]` tables. The default config ships Mistral Medium 3.5 (managed,
 * Devstral-based) plus Devstral Small and a local Devstral. We seed the
 * dropdown with those and merge any extra ids discovered from the user's
 * config via `modelOptions.ts`.
 */
export type VibeModel = string;

/** Default model alias (the shipped `active_model` in `~/.vibe/config.toml`). */
export const DEFAULT_VIBE_PRIMARY_MODEL: VibeModel = 'mistral-medium-3.5';

/** Display label for the default model. */
const DEFAULT_VIBE_PRIMARY_MODEL_LABEL = 'Mistral Medium 3.5';

/** Announced Vibe/Devstral context window (256K). */
export const DEFAULT_VIBE_CONTEXT_WINDOW = 256_000;

/**
 * Best-effort human label for a Vibe model id/alias (e.g. `devstral-small` →
 * `Devstral Small`). Callers with a real `display_name` should prefer that.
 */
export function formatVibeModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Vibe';
  }
  const tail = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  const words = tail
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.length > 0 ? words.join(' ') : tail;
}

function createVibeModelOption(model: VibeModel, label: string, description: string): ProviderUIOption {
  return { value: model, label, description };
}

/** Built-in default model options shown before any user/config additions. */
export const DEFAULT_VIBE_MODELS: ProviderUIOption[] = [
  createVibeModelOption(DEFAULT_VIBE_PRIMARY_MODEL, DEFAULT_VIBE_PRIMARY_MODEL_LABEL, 'Devstral-based, managed'),
  createVibeModelOption('devstral-small', 'Devstral Small', 'Schnell & günstig'),
  createVibeModelOption('local', 'Devstral (lokal)', 'Lokales llama.cpp-Modell'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_VIBE_MODEL_SET = new Set<string>(DEFAULT_VIBE_MODELS.map((model) => model.value));
