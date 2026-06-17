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
 * Curated catalog of model identifiers the Kimi / Moonshot stack exposes,
 * surfaced so the dropdown lists every selectable model rather than only the
 * single managed alias shipped in a fresh `config.toml`. Grouped by endpoint:
 * coding (K2.7 Code), the Kimi platform K2 line, and the legacy Moonshot v1
 * family. Ids the user's config already defines take precedence; these fill in
 * the rest. Sourced from kimi.com/code/docs + platform.kimi.ai model docs.
 */
export const KNOWN_KIMI_MODELS: ProviderUIOption[] = [
  // Coding endpoint (direct API; the subscription alias is the built-in default).
  createKimiModelOption('kimi-k2.7-code', 'Kimi · K2.7 Code', 'Coding · 256K · multimodal'),
  createKimiModelOption('kimi-k2.7-code-highspeed', 'Kimi · K2.7 Code High-Speed', 'Coding · 256K · faster (2×)'),
  // Kimi platform K2 line (API key path).
  createKimiModelOption('kimi-k2.6', 'Kimi · K2.6', 'Platform · 256K · thinking + multimodal'),
  createKimiModelOption('kimi-k2.5', 'Kimi · K2.5', 'Platform · 256K'),
  createKimiModelOption('kimi-k2-thinking', 'Kimi · K2 Thinking', 'Platform · 256K · reasoning'),
  createKimiModelOption('kimi-k2-thinking-turbo', 'Kimi · K2 Thinking Turbo', 'Platform · 256K · fast reasoning'),
  createKimiModelOption('kimi-k2-turbo-preview', 'Kimi · K2 Turbo', 'Platform · 256K · high-speed'),
  createKimiModelOption('kimi-k2-0905-preview', 'Kimi · K2 (0905)', 'Platform · 256K · preview'),
  createKimiModelOption('kimi-k2-0711-preview', 'Kimi · K2 (0711)', 'Platform · 128K · preview'),
  createKimiModelOption('kimi-latest', 'Kimi · Latest', 'Platform · always-latest alias'),
  createKimiModelOption('kimi-thinking-preview', 'Kimi · Thinking Preview', 'Platform · multimodal reasoning'),
  // Legacy Moonshot v1 family.
  createKimiModelOption('moonshot-v1-auto', 'Moonshot · v1 Auto', 'Legacy · auto context'),
  createKimiModelOption('moonshot-v1-8k', 'Moonshot · v1 8K', 'Legacy · 8K'),
  createKimiModelOption('moonshot-v1-32k', 'Moonshot · v1 32K', 'Legacy · 32K'),
  createKimiModelOption('moonshot-v1-128k', 'Moonshot · v1 128K', 'Legacy · 128K'),
  createKimiModelOption('moonshot-v1-128k-vision-preview', 'Moonshot · v1 128K Vision', 'Legacy · 128K · vision'),
];
