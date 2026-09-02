/**
 * Model type definitions and constants.
 */

/** Model identifier (string to support custom models via environment variables). */
export type ClaudeModel = string;

/**
 * Built-in Claude catalog: five pinned models, no floating aliases, no Haiku.
 *
 * Every id, label and context window below was read out of the installed Claude
 * Code binary's model table (2.1.258, `{id, display_name, context:{window,
 * native_1m}, capabilities}`), not inferred. All five are `window: 1e6,
 * native_1m: true`. The CLI's alias map today is `fable -> claude-fable-5-1`,
 * `opus -> claude-opus-5`, `sonnet -> claude-sonnet-5`; we pin the ids so a
 * silent alias move can never change which model a user is talking to.
 *
 * `[1m]` spellings: Fable 5.1 and Opus 5 are offered as a plain/[1m] pair that the
 * single "Opus 1M" toggle governs (see filterVisibleModelOptions). The CLI honours
 * the suffix on both (`supports_1m_suffix` on Opus; Fable normalises it). Fable 5,
 * Opus 4.8 and Sonnet 5 are listed once; their window is 1M regardless.
 *
 * Order = picker order. Fable 5.1 first because it is the flagship the user asked
 * for; it is NOT the settings default (see DEFAULT_CLAUDE_PROVIDER_SETTINGS), so a
 * fresh install never silently burns Fable usage credits.
 */
export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  { value: 'claude-fable-5-1', label: 'Fable 5.1', description: 'Mythos-Klasse, neuestes Flaggschiff (1M Kontext)' },
  { value: 'claude-fable-5-1[1m]', label: 'Fable 5.1 1M', description: 'Mythos-Klasse, neuestes Flaggschiff (1M-Kontext explizit)' },
  { value: 'claude-fable-5', label: 'Fable 5', description: 'Mythos-Klasse, vorheriges Flaggschiff (1M Kontext)' },
  { value: 'claude-opus-5', label: 'Opus 5', description: 'Stärkstes Opus, Fast-Modus verfügbar (1M Kontext)' },
  { value: 'claude-opus-5[1m]', label: 'Opus 5 1M', description: 'Stärkstes Opus, Fast-Modus verfügbar (1M-Kontext explizit)' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8', description: 'Vorheriges Opus, Fast-Modus verfügbar (1M Kontext)' },
  { value: 'claude-sonnet-5', label: 'Sonnet 5', description: 'Ausgewogen und schnell (1M Kontext)' },
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
  'claude-fable-5-1': 'high',
  'claude-fable-5-1[1m]': 'high',
  'claude-fable-5': 'high',
  'claude-opus-5': 'high',
  'claude-opus-5[1m]': 'high',
  'claude-opus-4-8': 'high',
  'claude-sonnet-5': 'high',
  // Legacy aliases still accepted from persisted settings / custom-model lists.
  'haiku': 'high',
  'sonnet': 'high',
  'sonnet[1m]': 'high',
  'opus': 'high',
  'opus[1m]': 'high',
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
 * Source: the installed Claude Code binary's model table (2.1.258), field
 * `context.window` / `context.native_1m`:
 *
 *   claude-fable-5-1   1_000_000  native_1m   (alias target of `fable`)
 *   claude-fable-5     1_000_000  native_1m
 *   claude-opus-5      1_000_000  native_1m   (alias target of `opus`)
 *   claude-opus-4-8    1_000_000  native_1m
 *   claude-opus-4-7    1_000_000  native_1m
 *   claude-sonnet-5    1_000_000  native_1m   (alias target of `sonnet`)
 *   claude-opus-4-6      200_000  (1M via beta header only)
 *   claude-haiku-4-5     200_000
 *
 * This corrects 5.102, which believed Opus 5 defaulted to 200K based on an older
 * CLI. The value the runtime later reads back from `modelUsage[<id>].contextWindow`
 * is the same table, so matching it keeps the usage badge stable from the first
 * render. Being wrong on a floating alias is self-correcting after one turn.
 */
function isOneMContextDefaultModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isFableFamilyModel(normalized)) return true;
  if (isBuiltInFamilyVariant(normalized, 'sonnet')) return true;
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  // Pinned ids: Opus 4.7+, Opus 5+, Sonnet 5+.
  return /claude-opus-(4-[7-9]|[5-9])(?!\d)/.test(normalized)
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
 * Read from the CLI 2.1.258 model table: the `fast_mode` capability is present
 * on claude-opus-5 and claude-opus-4-8 only. Fable 5 / 5.1 and Sonnet 5 do NOT
 * carry it (the CLI's own fallback check is `includes("opus-4-8") ||
 * includes("opus-5")`). The floating `opus` alias resolves to Opus 5 today and
 * stays in the allow-list; the CLI ignores `fastMode` on unsupported models.
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
 * `opus` alias, instead of needing a hand-maintained list per release. Fable rides
 * the Opus toggle too: the UI exposes ONE "1M-Kontext" switch for the flagship
 * tier, and Fable 5.1 / Opus 5 are the two models offered as a plain/[1m] pair.
 */
function oneMToggleForBase(
  base: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean,
): boolean | null {
  if (base.includes('opus') || base.includes('fable')) return enableOpus1M;
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

/**
 * Persisted values from builds that offered floating aliases (`haiku`, `sonnet`,
 * `opus`, `fable`, plus their `[1m]` spellings) map onto the pinned catalog id the
 * CLI resolves them to today (2.1.258 alias table). Haiku is no longer offered;
 * it lands on Sonnet 5, the closest fast tier. Without this, every existing
 * install would fall through to index 0 (Fable 5.1) and silently burn credits.
 */
const LEGACY_ALIAS_TO_CATALOG_ID: Record<string, string> = {
  'haiku': 'claude-sonnet-5',
  'sonnet': 'claude-sonnet-5',
  'opus': 'claude-opus-5',
  'fable': 'claude-fable-5-1',
};

export function migrateLegacyClaudeModelAlias(model: string): string {
  const normalized = normalizeModelId(model);
  const base = baseModelId(normalized);
  const target = LEGACY_ALIAS_TO_CATALOG_ID[base];
  if (!target) return model;
  // Sonnet 5 has a single spelling; the other targets keep an explicit [1m].
  if (has1MContextSuffix(normalized) && target !== 'claude-sonnet-5') {
    return `${target}${ONE_M_SUFFIX}`;
  }
  return target;
}

/** `haiku` / `sonnet` / `opus` / `fable` (optionally `[1m]`), as older builds persisted them. */
export function isLegacyClaudeAlias(model: string): boolean {
  return baseModelId(model) in LEGACY_ALIAS_TO_CATALOG_ID;
}

export function normalizeVisibleModelVariant(
  model: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): string {
  const migrated = migrateLegacyClaudeModelAlias(model);
  const base = baseModelId(migrated);
  if (!DEFAULT_ONE_M_TOGGLE_PAIRS.has(base)) {
    return migrated;
  }

  const prefer1M = oneMToggleForBase(base, enableOpus1M, enableSonnet1M);
  if (prefer1M === null) {
    return migrated;
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

  // Models that ship with a 1M context window natively (no `[1m]` opt-in): every
  // Fable id, Opus 4.7+, Opus 5, Sonnet 5 and the aliases that resolve to them.
  if (isOneMContextDefaultModel(model)) {
    return CONTEXT_WINDOW_1M;
  }

  return CONTEXT_WINDOW_STANDARD;
}
