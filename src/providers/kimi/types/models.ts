import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Kimi model catalog.
 *
 * Kimi (Moonshot) exposes a real `-m`/`--model` flag; the value is a `[models.*]`
 * table id from `~/.kimi/config.toml`. The live default config ships a single
 * managed coding model. We seed the dropdown with that default and merge any
 * additional ids the user discovers from their config via `modelOptions.ts`.
 */
export type KimiModel = string;

/** Default `-m` value (the managed coding model shipped in `~/.kimi/config.toml`). */
export const DEFAULT_KIMI_PRIMARY_MODEL: KimiModel = 'kimi-code/kimi-for-coding';

/** Display label for the default model (config `display_name = "K2.7 Code"`). */
const DEFAULT_KIMI_PRIMARY_MODEL_LABEL = 'Kimi · K2.7 Code';

/** Default context window for the managed coding model (config `max_context_size`). */
export const DEFAULT_KIMI_CONTEXT_WINDOW = 262_144;

/**
 * Best-effort human label for a Kimi model id.
 *
 * Config ids look like `kimi-code/kimi-for-coding` or `kimi-k2`. We surface the
 * trailing segment, title-cased, prefixed with `Kimi · ` so mixed dropdowns read
 * cleanly. Callers with a real `display_name` should prefer that instead.
 */
export function formatKimiModelLabel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) {
    return 'Kimi';
  }
  const tail = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed;
  const words = tail
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const pretty = words.length > 0 ? words.join(' ') : tail;
  return `Kimi · ${pretty}`;
}

function createKimiModelOption(model: KimiModel, label: string, description: string): ProviderUIOption {
  return { value: model, label, description };
}

/** Built-in default model options shown before any user/config additions. */
export const DEFAULT_KIMI_MODELS: ProviderUIOption[] = [
  createKimiModelOption(DEFAULT_KIMI_PRIMARY_MODEL, DEFAULT_KIMI_PRIMARY_MODEL_LABEL, 'Default'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_KIMI_MODEL_SET = new Set<string>(DEFAULT_KIMI_MODELS.map((model) => model.value));

/**
 * Curated catalog of model identifiers the Kimi / Moonshot coding endpoint
 * exposes. The dropdown is intentionally limited to the three coding models so
 * users do not pick platform / legacy ids that do not work with the current
 * coding OAuth setup. Ids the user's config already defines take precedence;
 * these fill in the rest. Sourced from kimi.com/code/docs.
 */
export const KNOWN_KIMI_MODELS: ProviderUIOption[] = [
  // Coding endpoint (direct API; the subscription alias is the built-in default).
  createKimiModelOption('kimi-k2.7-code', 'Kimi · K2.7 Code', 'Coding · 256K · multimodal'),
  createKimiModelOption('kimi-k2.7-code-highspeed', 'Kimi · K2.7 Code High-Speed', 'Coding · 256K · faster (2×)'),
];
