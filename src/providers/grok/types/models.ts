import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Grok (xAI) model catalog.
 *
 * The Grok CLI selects the model with `-m`/`--model` (value is a model id, or a
 * custom id from `~/.grok/config.toml`). `grok models` reports the real default
 * and the served ids, and the CLI hard-rejects anything else:
 *
 *     $ grok -m grok-composer-2.5-fast -p "hi"
 *     Couldn't set model 'grok-composer-2.5-fast': Invalid params: "unknown
 *     model id". Run 'grok models' to see available models.
 *
 * The served list currently reads:
 *
 *     $ grok models
 *     Default model: grok-4.6
 *     Available models:
 *       * grok-4.6 (default)
 *       - grok-4.5
 *
 * The older catalog (`grok-composer-2.5-fast`, `grok-build`, `grok-code-fast-1`)
 * is retired — all three were verified to be rejected, which meant every
 * built-in Grok selection failed to start a turn. Keep this list matched to
 * `grok models`; extra ids from the user's config are merged in by
 * `modelOptions.ts`, and `resolveGrokModelSelection` migrates a persisted id
 * that is no longer offered back to the default.
 */
export type GrokModel = string;

/** Default `-m` value — mirrors `grok models`' reported default. */
export const DEFAULT_GROK_PRIMARY_MODEL: GrokModel = 'grok-4.6';

/** Display label for the default model. */
const DEFAULT_GROK_PRIMARY_MODEL_LABEL = 'Grok 4.6';

/** Previous generation, still served and still selectable. */
export const GROK_45_MODEL: GrokModel = 'grok-4.5';

/**
 * Fallback context window for ids we know nothing about (hand-typed custom
 * models whose `[models.*]` table omits `max_context_size`). Served models get
 * their real window from KNOWN_GROK_MODEL_CONTEXT_WINDOWS instead.
 */
export const DEFAULT_GROK_CONTEXT_WINDOW = 256_000;

/** Published context windows per served model id (xAI model docs). */
export const KNOWN_GROK_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  'grok-4.6': 500_000,
  'grok-4.5': 500_000,
});

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
  createGrokModelOption(DEFAULT_GROK_PRIMARY_MODEL, DEFAULT_GROK_PRIMARY_MODEL_LABEL, 'CLI-Standardmodell · 500K Kontext'),
  createGrokModelOption(GROK_45_MODEL, 'Grok 4.5', 'Vorherige Generation · 500K Kontext'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_GROK_MODEL_SET = new Set<string>(DEFAULT_GROK_MODELS.map((model) => model.value));
