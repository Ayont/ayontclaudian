/**
 * Model type definitions and constants.
 */

/** Model identifier (string to support custom models via environment variables). */
export type ClaudeModel = string;

export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  { value: 'haiku', label: 'Haiku', description: 'Fast and efficient' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced performance' },
  { value: 'sonnet[1m]', label: 'Sonnet 1M', description: 'Balanced performance (1M context window)' },
  // `opus` is a floating alias — the CLI resolves it to "the latest model" server-side,
  // so it always tracks the newest Opus release without a plugin change. The SDK's own
  // `supportedModels()` reports the alias resolving to `claude-opus-4-8[1m]` today.
  { value: 'opus', label: 'Opus', description: 'Most capable (tracks the latest release)' },
  { value: 'opus[1m]', label: 'Opus 1M', description: 'Most capable (1M context window)' },
  // Pinned dated IDs alongside the floating `opus` alias, so a specific generation stays
  // selectable even after `opus` moves on to a newer release. Both verified live and still
  // reachable today — Anthropic keeps prior dated Opus snapshots available after a new
  // default ships, same precedent as `claude-opus-4-5`/`claude-opus-4-6`/`claude-opus-4-7`.
  //
  // Unlike Opus 4.8, `claude-opus-5` defaults to a 200K window and offers 1M as an opt-in
  // (measured: `claude-opus-5` -> 200000, `claude-opus-5[1m]` -> 1000000). Both spellings
  // are listed so the `enableOpus1M` toggle governs the pinned entry the same way it
  // governs the floating alias — see filterVisibleModelOptions().
  { value: 'claude-opus-5', label: 'Opus 5', description: 'Pinned to Opus 5 — stays fixed even once a newer Opus becomes the `opus` default' },
  { value: 'claude-opus-5[1m]', label: 'Opus 5 1M', description: 'Pinned to Opus 5 with the 1M context window opt-in' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Pinned to the previous Opus 4.8 release (1M context by default)' },
  // Fable 5 is Anthropic's Mythos-class flagship (introduced with Claude Code 2.1.170).
  // It ships with a 1M context window by default, so there is no separate `[1m]` variant —
  // the CLI strips a `[1m]` suffix automatically (changelog 2.1.173). Placed last (not at
  // index 0) so it never becomes the accidental default and silently consumes usage credits.
  { value: 'fable', label: 'Fable', description: 'Mythos-class flagship (1M context by default)' },
];

/**
 * Effort levels for adaptive thinking models.
 *
 * `ultracode` is Claude Code's top setting (since v2.1.154): it sends `xhigh`
 * effort AND has Claude stand up dynamic multi-agent workflows for substantive
 * tasks. It is a session setting, not an API effort value, so it maps to `xhigh`
 * for the API and is activated separately via the `ultracode` flag setting. Like
 * `xhigh`, it is only offered on `xhigh`-capable models (Opus 4.7+).
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode';

export const EFFORT_LEVELS: { value: EffortLevel; label: string; description: string }[] = [
  { value: 'low', label: 'Low', description: 'Effizient — Token-sparend, kurze Aufgaben' },
  { value: 'medium', label: 'Med', description: 'Ausgewogen — moderate Einsparung' },
  { value: 'high', label: 'High', description: 'Standard — komplexes Reasoning & Agentic' },
  { value: 'xhigh', label: 'XHigh', description: 'Erweitert — lange Coding-Läufe (>30 Min)' },
  { value: 'max', label: 'Max', description: 'Maximum — kein Token-Limit, tiefstes Reasoning' },
  { value: 'ultracode', label: 'Ultracode', description: 'XHigh + automatische Multi-Agent-Workflows (Session)' },
];

/** Effort levels that are session-only (not persisted) — surfaced in the UI. */
export const SESSION_ONLY_EFFORT_LEVELS = new Set<EffortLevel>(['max', 'ultracode']);

/** Default effort level per model tier. */
export const DEFAULT_EFFORT_LEVEL: Record<string, EffortLevel> = {
  'haiku': 'high',
  'sonnet': 'high',
  'sonnet[1m]': 'high',
  'opus': 'high',
  'opus[1m]': 'high',
  'claude-opus-5': 'high',
  'claude-opus-5[1m]': 'high',
  'claude-opus-4-8': 'high',
  'fable': 'high',
  'fable[1m]': 'high',
};

const ONE_M_SUFFIX = '[1m]';
const DEFAULT_MODEL_VALUES = new Set(DEFAULT_CLAUDE_MODELS.map(m => m.value.toLowerCase()));

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function has1MContextSuffix(model: string): boolean {
  return normalizeModelId(model).endsWith(ONE_M_SUFFIX);
}

function isBuiltInFamilyVariant(model: string, family: 'sonnet' | 'opus' | 'fable'): boolean {
  const normalized = normalizeModelId(model);
  // Fable 5 includes 1M context by default and has no opt-out `[1m]` variant; the CLI
  // normalizes a stray `fable[1m]` back to `fable`. Accept both for resilience.
  if (family === 'fable') {
    return normalized === 'fable' || normalized === 'fable[1m]';
  }
  return normalized === family || normalized === `${family}${ONE_M_SUFFIX}`;
}

/**
 * Whether `model` belongs to the Fable (Mythos-class) family — either the bare
 * `fable` alias / `fable[1m]`, or a full name like `claude-fable-5`. Fable ships
 * with a 1M context window by default and is xhigh/ultracode-capable.
 */
function isFableFamilyModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  return normalized === 'fable' || normalized === 'fable[1m]' || /claude-fable-\d/.test(normalized);
}

/**
 * Whether `model` ships with a 1M context window **by default** — no `[1m]` opt-in
 * needed.
 *
 * Every entry here was measured, not inferred: a one-token turn was run per model
 * id and the CLI's own `modelUsage[<id>].contextWindow` from the result message
 * was read back (Claude Code 2.1.226 / SDK 0.3.209). That number is the same one
 * the runtime later uses to overwrite our estimate, so matching it keeps the usage
 * badge stable from the first render instead of jumping after the first turn.
 *
 *   sonnet            -> claude-sonnet-5    1_000_000
 *   opus              -> claude-opus-4-8    1_000_000
 *   haiku             -> claude-haiku-4-5     200_000
 *   fable             -> claude-fable-5    1_000_000
 *   claude-opus-4-8                        1_000_000
 *   claude-opus-4-7                        1_000_000
 *   claude-opus-4-6                          200_000
 *   claude-opus-5                            200_000
 *   claude-opus-5[1m]                      1_000_000
 *
 * Two corrections against what this file previously assumed:
 *
 * 1. The bare `sonnet` / `opus` aliases are 1M today. They used to fall through
 *    to the 200K default, which under-reported the window 5x on the two models
 *    users actually pick — the badge read "50% full" at 100K of a 1M window.
 * 2. `claude-opus-5` and `claude-opus-4-6` are 200K, not 1M. A published summary
 *    claimed Opus 5 was "1M context window (default and maximum)"; the CLI says
 *    otherwise, and `claude-opus-5[1m]` really does report 1M, so 1M is an opt-in
 *    there rather than the default. 1M-as-default starts at Opus 4.7.
 *
 * The aliases are included deliberately even though they float. Being wrong on a
 * floating alias is self-correcting (the runtime overwrites the value with the
 * authoritative one after the first turn) and one-directional in cost: guessing
 * 200K when it is 1M shows a badge 5x too full and invites premature compaction,
 * while guessing 1M when it is 200K only under-warns for a single turn.
 */
function isOneMContextDefaultModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isFableFamilyModel(normalized)) return true;
  // Floating aliases, as resolved by Claude Code 2.1.226. `haiku` stays 200K.
  if (isBuiltInFamilyVariant(normalized, 'sonnet')) return true;
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  // Pinned ids: Opus 4.7+ (NOT 4.6, and NOT the 5 line) and Sonnet 5+.
  return /claude-opus-4-[7-9]/.test(normalized)
    || /claude-sonnet-[5-9]/.test(normalized);
}

function isValidContextLimit(limit: unknown): limit is number {
  return typeof limit === 'number' && limit > 0 && !isNaN(limit) && isFinite(limit);
}

function resolveCustomContextLimit(
  model: string,
  customLimits?: Record<string, number>,
): number | null {
  if (!customLimits) {
    return null;
  }

  const exactLimit = customLimits[model];
  if (isValidContextLimit(exactLimit)) {
    return exactLimit;
  }

  const normalizedModel = normalizeModelId(model);
  const matchingLimits = Object.entries(customLimits)
    .filter(([key, limit]) => key !== model && normalizeModelId(key) === normalizedModel && isValidContextLimit(limit))
    .map(([, limit]) => limit);

  return matchingLimits.length === 1 ? matchingLimits[0] : null;
}

export function isDefaultClaudeModel(model: string): boolean {
  return DEFAULT_MODEL_VALUES.has(normalizeModelId(model));
}

/**
 * Whether Claude Code can serve this model through fast mode (`/fast`).
 *
 * Official support is Opus 5 and Opus 4.8 only. Opus 4.7 had fast mode
 * removed in July 2026. Sonnet, Haiku, and Fable are not on that path.
 * The floating `opus` alias currently resolves to a supported generation,
 * so it stays in the allow-list; a future alias move is self-correcting
 * because the CLI ignores `fastMode` on unsupported models.
 */
export function supportsClaudeFastMode(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  return /claude-opus-5/.test(normalized) || /claude-opus-4-8/.test(normalized);
}

export function isClaudeFastModeEnabled(model: string, serviceTier: unknown): boolean {
  return serviceTier === 'fast' && supportsClaudeFastMode(model);
}

export const CLAUDE_FAST_MODE_DESCRIPTION =
  'Opus bis zu 2,5× schneller. Gleiche Qualität, höhere Token-Kosten. Nur Opus 5 und Opus 4.8.';

/**
 * Whether the model supports the `xhigh` effort level.
 *
 * Per the bundled SDK (`sdk.d.ts`: "`'xhigh'` — Deeper than high (Fable 5, Opus
 * 4.7+, Sonnet 5)"): Fable/Mythos, Opus 4.7+, and Sonnet 5+. The SDK silently
 * falls back to `high` elsewhere.
 *
 * Both bare aliases count. Unlike the context-window default (see
 * isOneMContextDefaultModel, which deliberately excludes the floating aliases),
 * being wrong here is cheap and one-directional: the SDK documents `sonnet` ->
 * `claude-sonnet-5`, and if a future alias ever loses xhigh the SDK just downgrades
 * to `high`. Gating the alias OFF was the expensive mistake — it hid the level
 * entirely and made normalizeEffortLevel() silently rewrite a user's `xhigh` to
 * `high` on switching to Sonnet, with no way to get it back.
 */
export function supportsXHighEffort(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  if (isBuiltInFamilyVariant(normalized, 'sonnet')) return true;
  if (isFableFamilyModel(normalized)) return true;
  return /claude-opus-(4-[7-9]|[5-9])/.test(normalized)
    || /claude-sonnet-[5-9]/.test(normalized);
}

/**
 * Whether the model supports the `max` effort level.
 *
 * Per the bundled SDK (`sdk.d.ts`: "`'max'` — Maximum effort (Fable 5, Opus 4.6+,
 * Sonnet 4.6+)"), with `max` *erroring* rather than silently downgrading on
 * Haiku 4.5 and Sonnet 4.5.
 *
 * Deliberately a DENY-list, unlike supportsXHighEffort's allow-list: an unknown
 * or custom model id (a gateway model, a pinned id newer than this build) keeps
 * `max`. Flipping this to an allow-list would strip the level from every custom
 * model — a regression for a real use case — to guard against a mislabel. So we
 * only refuse where the SDK says it actually breaks.
 */
export function supportsMaxEffort(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (normalized === 'haiku' || /claude-haiku-/.test(normalized)) return false;
  // Sonnet 4.5 and older; 4.6+ and 5+ are fine.
  if (/claude-sonnet-(4-[0-5]|3)/.test(normalized)) return false;
  return true;
}

/**
 * Single source of truth for "may this model run at this effort level".
 *
 * Both the UI picker and the persisted-value clamp go through here. They used to
 * encode the rule independently, which is exactly how they drifted apart — the
 * picker offered `max` on every model while the clamp gated only `xhigh`.
 */
export function isEffortLevelSupported(model: string, level: EffortLevel): boolean {
  // `ultracode` is xhigh + multi-agent orchestration, so it inherits xhigh's gate.
  if (level === 'xhigh' || level === 'ultracode') return supportsXHighEffort(model);
  if (level === 'max') return supportsMaxEffort(model);
  return true;
}

/** Clamp stored effort values to what the selected model actually supports. */
export function normalizeEffortLevel(
  model: string,
  effortLevel: unknown,
): EffortLevel {
  const isSupported = EFFORT_LEVELS.some((level) =>
    level.value === effortLevel && isEffortLevelSupported(model, level.value)
  );

  if (isSupported) {
    return effortLevel as EffortLevel;
  }

  return DEFAULT_EFFORT_LEVEL[normalizeModelId(model)] ?? 'high';
}

/** Whether the stored effort selects Claude Code's ultracode mode. */
export function isUltracodeEffort(effortLevel: unknown): boolean {
  return effortLevel === 'ultracode';
}

/**
 * Effort value to send to the SDK/API. `ultracode` is a session setting, not an
 * API effort level — it maps to `xhigh` (and is activated separately via the
 * `ultracode` flag). All other levels pass through unchanged.
 */
export function toApiEffortLevel(effortLevel: EffortLevel): Exclude<EffortLevel, 'ultracode'> {
  return effortLevel === 'ultracode' ? 'xhigh' : effortLevel;
}

export function resolveEffortLevel(
  model: string,
  effortLevel: unknown,
): EffortLevel {
  return normalizeEffortLevel(model, effortLevel);
}

export const CONTEXT_WINDOW_STANDARD = 200_000;
export const CONTEXT_WINDOW_1M = 1_000_000;

/** The model id with any `[1m]` suffix stripped, lowercased. */
function baseModelId(model: string): string {
  const normalized = normalizeModelId(model);
  return has1MContextSuffix(normalized)
    ? normalized.slice(0, -ONE_M_SUFFIX.length)
    : normalized;
}

/**
 * Which 1M toggle governs `base`, or null when neither does.
 *
 * Substring matching (rather than an exact alias check) is what lets pinned ids
 * such as `claude-opus-5` ride the same `enableOpus1M` setting as the floating
 * `opus` alias, instead of needing a hand-maintained list per release.
 */
function oneMToggleForBase(
  base: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean,
): boolean | null {
  if (base.includes('opus')) return enableOpus1M;
  if (base.includes('sonnet')) return enableSonnet1M;
  return null;
}

/**
 * Bases that appear in `models` under BOTH a plain and a `[1m]` spelling.
 *
 * Only those are toggle pairs. A model listed once — `fable`, `haiku`,
 * `claude-opus-4-8` — has no alternative spelling to switch to and must stay
 * visible under either setting.
 */
function collectOneMTogglePairs<T extends { value: string }>(models: T[]): Set<string> {
  const plain = new Set<string>();
  const oneM = new Set<string>();
  for (const model of models) {
    const normalized = normalizeModelId(model.value);
    (has1MContextSuffix(normalized) ? oneM : plain).add(baseModelId(normalized));
  }

  const pairs = new Set<string>();
  for (const base of plain) {
    if (oneM.has(base)) pairs.add(base);
  }
  return pairs;
}

/** Toggle pairs of the built-in catalog, computed once — the picker re-renders often. */
const DEFAULT_ONE_M_TOGGLE_PAIRS = collectOneMTogglePairs(DEFAULT_CLAUDE_MODELS);

export function filterVisibleModelOptions<T extends { value: string }>(
  models: T[],
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): T[] {
  const togglePairs = collectOneMTogglePairs(models);

  return models.filter((model) => {
    const base = baseModelId(model.value);
    if (!togglePairs.has(base)) {
      return true;
    }

    const prefer1M = oneMToggleForBase(base, enableOpus1M, enableSonnet1M);
    if (prefer1M === null) {
      return true;
    }

    return prefer1M === has1MContextSuffix(model.value);
  });
}

export function normalizeVisibleModelVariant(
  model: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): string {
  const base = baseModelId(model);
  if (!DEFAULT_ONE_M_TOGGLE_PAIRS.has(base)) {
    return model;
  }

  const prefer1M = oneMToggleForBase(base, enableOpus1M, enableSonnet1M);
  if (prefer1M === null) {
    return model;
  }

  return prefer1M ? `${base}${ONE_M_SUFFIX}` : base;
}

export function getContextWindowSize(
  model: string,
  customLimits?: Record<string, number>
): number {
  const customLimit = resolveCustomContextLimit(model, customLimits);
  if (customLimit !== null) {
    return customLimit;
  }

  // Explicit `[1m]` suffix always wins (Sonnet/Opus 1M variants).
  if (has1MContextSuffix(model)) {
    return CONTEXT_WINDOW_1M;
  }

  // Models that ship with a 1M context window by default (no `[1m]` opt-in): the
  // bare `fable` alias, `fable[1m]`, `claude-fable-5`, and every pinned Opus 4.6+
  // dated id (`claude-opus-5`, `claude-opus-4-8`, ...).
  if (isOneMContextDefaultModel(model)) {
    return CONTEXT_WINDOW_1M;
  }

  return CONTEXT_WINDOW_STANDARD;
}
