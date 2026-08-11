import type { ProviderUIOption } from '../../../core/providers/types';

/**
 * Kimi model catalog.
 *
 * Kimi (Moonshot) exposes a real `-m`/`--model` flag. The value must be a model
 * id the CLI knows: either a `[models.*]` table in `~/.kimi/config.toml`, or one
 * of the managed ids the Kimi Code OAuth session provides. `kimi provider list
 * --json` prints the resolved set, which is authoritative:
 *
 *     kimi-code/k3                          K3                     1048576  efforts: low/high/max
 *     kimi-code/kimi-for-coding             K2.7 Coding             262144
 *     kimi-code/kimi-for-coding-highspeed   K2.7 Coding Highspeed   262144
 *     Default model: kimi-code/k3
 *
 * All three are served through the managed provider and work with no config
 * entry at all (verified: `kimi -m kimi-code/k3 -p ...` answers on a config that
 * declares only `kimi-code/kimi-for-coding`).
 *
 * The previous catalog invented bare ids — `kimi-k3`, `kimi-k2.7-code`,
 * `kimi-k2.7-code-highspeed` — which the CLI rejects outright:
 *
 *     error: config.invalid: Model "kimi-k3" is not configured in config.toml.
 *
 * They only became usable after the plugin appended a `[models."kimi-k3"]`
 * section to the user's config, and that generated section carries no
 * `provider`/`model` mapping, so it could not route to the coding endpoint the
 * way the managed entry does. Using the CLI's own namespaced ids removes both
 * the failure and the need to write to the user's config for a built-in model.
 */
export type KimiModel = string;

/** `kimi provider list`'s reported default — the K3 flagship, 1M context. */
export const DEFAULT_KIMI_PRIMARY_MODEL: KimiModel = 'kimi-code/k3';

/** Display label for the default model (managed `displayName = "K3"`). */
const DEFAULT_KIMI_PRIMARY_MODEL_LABEL = 'Kimi · K3';

/** Context window of the K2.7 coding models, and the fallback for unknown ids. */
export const DEFAULT_KIMI_CONTEXT_WINDOW = 262_144;

/** Managed K3 model id. */
export const KIMI_K3_MODEL: KimiModel = 'kimi-code/k3';

/** K3 ships a 1M-token context window (managed `maxContextSize`). */
export const KIMI_K3_CONTEXT_WINDOW = 1_048_576;

/** Managed K2.7 coding model ids. */
export const KIMI_K27_CODE_MODEL: KimiModel = 'kimi-code/kimi-for-coding';
export const KIMI_K27_CODE_HIGHSPEED_MODEL: KimiModel = 'kimi-code/kimi-for-coding-highspeed';

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

/**
 * Built-in model options, in the order `kimi provider list` reports them.
 *
 * All three are managed ids served over the Kimi Code OAuth session, so unlike
 * the old invented ids they need no `[models.*]` entry and are always safe to
 * offer.
 */
export const DEFAULT_KIMI_MODELS: ProviderUIOption[] = [
  createKimiModelOption(KIMI_K3_MODEL, DEFAULT_KIMI_PRIMARY_MODEL_LABEL, 'Flagship · 1M · multimodal · reasoning'),
  createKimiModelOption(KIMI_K27_CODE_MODEL, 'Kimi · K2.7 Coding', 'Coding · 256K · multimodal'),
  createKimiModelOption(KIMI_K27_CODE_HIGHSPEED_MODEL, 'Kimi · K2.7 Coding Highspeed', 'Coding · 256K · schneller'),
];

/** Fast lookup for whether a model id is one of the built-in defaults. */
export const DEFAULT_KIMI_MODEL_SET = new Set<string>(DEFAULT_KIMI_MODELS.map((model) => model.value));

/**
 * Curated catalog used for labels, descriptions and context windows.
 *
 * Identical to the built-in set today: every managed id the CLI serves is
 * already offered unconditionally. It stays a separate export because
 * `modelOptions.ts` uses it to give a *configured* id its curated label instead
 * of a derived one, and because a future managed id may again need the
 * "only when configured" treatment.
 */
export const KNOWN_KIMI_MODELS: ProviderUIOption[] = [...DEFAULT_KIMI_MODELS];

/** Fast lookup for whether a model id is in the curated catalog. */
export const KNOWN_KIMI_MODEL_SET = new Set<string>(KNOWN_KIMI_MODELS.map((model) => model.value));

/**
 * Context windows for the catalog ids, straight from `kimi provider list
 * --json` (`maxContextSize`). Used when the user's config.toml does not declare
 * the model, and when seeding a new section via `ensureKimiModelConfigured`.
 */
export const KNOWN_KIMI_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = Object.freeze({
  [KIMI_K3_MODEL]: KIMI_K3_CONTEXT_WINDOW,
  [KIMI_K27_CODE_MODEL]: DEFAULT_KIMI_CONTEXT_WINDOW,
  [KIMI_K27_CODE_HIGHSPEED_MODEL]: DEFAULT_KIMI_CONTEXT_WINDOW,
});

/** Catalog context window for a model id, or null when not in the catalog. */
export function getKnownKimiModelContextWindow(model: string): number | null {
  return KNOWN_KIMI_MODEL_CONTEXT_WINDOWS[model] ?? null;
}
