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
  // so it always tracks the newest Opus release without a plugin change (verified live:
  // `claude --model opus` self-reported `claude-opus-5` on 2026-07-28).
  { value: 'opus', label: 'Opus', description: 'Most capable (tracks the latest release — currently Opus 5)' },
  { value: 'opus[1m]', label: 'Opus 1M', description: 'Most capable (1M context window)' },
  // Pinned dated IDs alongside the floating `opus` alias, so a specific generation stays
  // selectable even after `opus` moves on to a newer release. Both verified live and still
  // reachable today (`claude --model claude-opus-5|claude-opus-4-8 -p ...` both responded,
  // 2026-07-28) — Anthropic keeps prior dated Opus snapshots available after a new default
  // ships, same precedent as `claude-opus-4-5`/`claude-opus-4-6`/`claude-opus-4-7`.
  // Both ship 1M context by default, so they are NOT gated behind the `enableOpus1M`
  // toggle — there is no 200K variant to toggle back to. See isOneMContextDefaultModel().
  { value: 'claude-opus-5', label: 'Opus 5', description: 'Pinned to Opus 5 (1M context by default) — stays fixed even once a newer Opus becomes the `opus` default' },
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
 * needed, and no long-context price premium.
 *
 * Covers Fable (Mythos-class) plus every pinned Opus 4.6+ dated id. Per Anthropic's
 * model catalog, Opus 4.6 / 4.7 / 4.8 / 5 all list a 1M context window as the
 * default (Opus 5: "1M context window (default and maximum)"), which is why the
 * `[1m]` suffix is accepted but a no-op on them (verified live: `claude --model
 * "claude-opus-5[1m]"` and `"claude-opus-4-8[1m]"` both answer normally).
 *
 * Deliberately does NOT match the bare `opus` / `opus[1m]` aliases: those stay
 * governed by the `enableOpus1M` toggle, because the alias floats to whatever
 * Anthropic ships next and we shouldn't assume a future Opus keeps 1M as its
 * default. Pinned ids are a known quantity; the floating alias is not.
 */
function isOneMContextDefaultModel(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isFableFamilyModel(normalized)) return true;
  // Same version-parsing shape as supportsXHighEffort, one minor version wider
  // (1M context landed in Opus 4.6; xhigh effort only in 4.7).
  return /claude-opus-(4-[6-9]|[5-9])/.test(normalized);
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

export function filterVisibleModelOptions<T extends { value: string }>(
  models: T[],
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): T[] {
  return models.filter((model) => {
    if (isBuiltInFamilyVariant(model.value, 'opus')) {
      return enableOpus1M ? has1MContextSuffix(model.value) : normalizeModelId(model.value) === 'opus';
    }

    if (isBuiltInFamilyVariant(model.value, 'sonnet')) {
      return enableSonnet1M ? has1MContextSuffix(model.value) : normalizeModelId(model.value) === 'sonnet';
    }

    return true;
  });
}

export function normalizeVisibleModelVariant(
  model: string,
  enableOpus1M: boolean,
  enableSonnet1M: boolean
): string {
  if (isBuiltInFamilyVariant(model, 'opus')) {
    return enableOpus1M ? 'opus[1m]' : 'opus';
  }

  if (isBuiltInFamilyVariant(model, 'sonnet')) {
    return enableSonnet1M ? 'sonnet[1m]' : 'sonnet';
  }

  return model;
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
