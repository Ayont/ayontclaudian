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
 * Verified against Grok CLI 1.0.40 (`grok models`, 2026-09-22):
 *
 *     Default model: grok-4.7
 *     Available models:
 *       * grok-4.7 (default)
 *       - grok-4.7-build-fast
 *       - grok-4.6
 *       - grok-4.5
 *
 * Context windows come from the CLI's own model cache
 * (`~/.grok/models_cache.json`, origin `cli-chat-proxy.grok.com/v1/models`),
 * which reports `context_window: 500000` for every served id. That matches the
 * xAI docs for `grok-4.7` (500,000 tokens). Grok 4.7 Fast is the same model on
 * faster infrastructure (`grok-4.7-build-fast`), so it has the same window.
 * The public rate card bills a long-context rate once the prompt exceeds
 * 200,000 tokens; the window itself stays 500,000.
 *
 * The older catalog (`grok-composer-2.5-fast`, `grok-build`, `grok-code-fast-1`)
 * is retired — all three were verified to be rejected, which meant every
 * built-in Grok selection failed to start a turn. Keep this list matched to
 * `grok models`; extra ids from the user's config are merged in by
 * `modelOptions.ts`, and `resolveGrokModelSelection` migrates a persisted id
 * that is no longer offered back to the default.
 */
export type GrokModel = string;

/** Frontier model. Default `-m` value — mirrors `grok models`. */
export const GROK_47_MODEL: GrokModel = 'grok-4.7';

/** Same model as {@link GROK_47_MODEL}, served on faster infrastructure. */
export const GROK_47_FAST_MODEL: GrokModel = 'grok-4.7-build-fast';

/** Previous generation, still served. */
export const GROK_46_MODEL: GrokModel = 'grok-4.6';

/** Previous generation, still served. No `xhigh` effort. */
export const GROK_45_MODEL: GrokModel = 'grok-4.5';

/** Default `-m` value — mirrors `grok models`' reported default. */
export const DEFAULT_GROK_PRIMARY_MODEL: GrokModel = GROK_47_MODEL;

/** Display label for the default model. */
const DEFAULT_GROK_PRIMARY_MODEL_LABEL = 'Grok 4.7';

/**
 * Fallback context window for ids we know nothing about (hand-typed custom
 * models whose `[models.*]` table omits `max_context_size`). Served models get
 * their real window from KNOWN_GROK_MODEL_CONTEXT_WINDOWS instead.
 */
export const DEFAULT_GROK_CONTEXT_WINDOW = 256_000;

/**
 * Prompt size at which xAI switches `grok-4.7` (and Fast) to the long-context
 * token rate. This is a billing band, not a smaller window.
 */
export const GROK_LONG_CONTEXT_TOKEN_THRESHOLD = 200_000;

/** Published context windows per served model id (CLI model cache + xAI docs). */
export const KNOWN_GROK_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  [GROK_47_MODEL]: 500_000,
  [GROK_47_FAST_MODEL]: 500_000,
  [GROK_46_MODEL]: 500_000,
  [GROK_45_MODEL]: 500_000,
});

/** Reasoning efforts `grok --reasoning-effort` accepts on Grok 4.7 / 4.6 / Fast. */
export const GROK_REASONING_EFFORTS = ['xhigh', 'high', 'medium', 'low'] as const;

export type GrokReasoningEffort = (typeof GROK_REASONING_EFFORTS)[number];

/** CLI default for every served model (`reasoning_effort: "high"`). */
export const GROK_DEFAULT_REASONING_EFFORT: GrokReasoningEffort = 'high';

const GROK_45_REASONING_EFFORTS: readonly GrokReasoningEffort[] = ['high', 'medium', 'low'];

const GROK_REASONING_LABELS: Record<GrokReasoningEffort, { label: string; description: string }> = {
  xhigh: { label: 'Extra hoch', description: 'Maximales Nachdenken für die schwersten Aufgaben' },
  high: { label: 'Hoch', description: 'Gründlich. Empfohlen.' },
  medium: { label: 'Mittel', description: 'Stark, aber schneller' },
  low: { label: 'Niedrig', description: 'Am schnellsten, für einfache Aufgaben' },
};

/** Efforts the CLI advertises for this model. Unknown ids get the 4.7 set. */
export function getGrokReasoningEfforts(model: string): readonly GrokReasoningEffort[] {
  return model.trim() === GROK_45_MODEL ? GROK_45_REASONING_EFFORTS : GROK_REASONING_EFFORTS;
}

/**
 * Returns a CLI-accepted effort for `model`, or null when the value is empty
 * or not offered (for example `xhigh` on Grok 4.5).
 */
export function normalizeGrokReasoningEffort(
  value: string | null | undefined,
  model: string,
): GrokReasoningEffort | null {
  const trimmed = value?.trim().toLowerCase() ?? '';
  if (!trimmed) {
    return null;
  }
  return getGrokReasoningEfforts(model).find((effort) => effort === trimmed) ?? null;
}

export function grokReasoningOption(effort: GrokReasoningEffort): ProviderUIOption {
  const copy = GROK_REASONING_LABELS[effort];
  return { value: effort, label: copy.label, description: copy.description };
}

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

const GROK_LONG_CONTEXT_LABEL = `Langkontext ab ${GROK_LONG_CONTEXT_TOKEN_THRESHOLD / 1000}K`;

/** Built-in default model options shown before any user/config additions. */
export const DEFAULT_GROK_MODELS: ProviderUIOption[] = [
  createGrokModelOption(
    DEFAULT_GROK_PRIMARY_MODEL,
    DEFAULT_GROK_PRIMARY_MODEL_LABEL,
    `Stabil · 500K Kontext · ${GROK_LONG_CONTEXT_LABEL}`,
  ),
  createGrokModelOption(
    GROK_47_FAST_MODEL,
    'Grok 4.7 Fast',
    `Schnell · gleiche 500K · doppelter Tarif · ${GROK_LONG_CONTEXT_LABEL}`,
  ),
  createGrokModelOption(GROK_46_MODEL, 'Grok 4.6', 'Vorherige Generation · 500K Kontext'),
  createGrokModelOption(GROK_45_MODEL, 'Grok 4.5', 'Vorherige Generation · 500K Kontext'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_GROK_MODEL_SET = new Set<string>(DEFAULT_GROK_MODELS.map((model) => model.value));
