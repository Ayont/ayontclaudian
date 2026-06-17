/**
 * Model type definitions and constants.
 */

/** Model identifier (string to support custom models via environment variables). */
export type ClaudeModel = string;

export const DEFAULT_CLAUDE_MODELS: { value: ClaudeModel; label: string; description: string }[] = [
  { value: 'haiku', label: 'Haiku', description: 'Fast and efficient' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced performance' },
  { value: 'sonnet[1m]', label: 'Sonnet 1M', description: 'Balanced performance (1M context window)' },
  { value: 'opus', label: 'Opus', description: 'Most capable' },
  { value: 'opus[1m]', label: 'Opus 1M', description: 'Most capable (1M context window)' },
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
};

const ONE_M_SUFFIX = '[1m]';
const DEFAULT_MODEL_VALUES = new Set(DEFAULT_CLAUDE_MODELS.map(m => m.value.toLowerCase()));

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase();
}

function has1MContextSuffix(model: string): boolean {
  return normalizeModelId(model).endsWith(ONE_M_SUFFIX);
}

function isBuiltInFamilyVariant(model: string, family: 'sonnet' | 'opus'): boolean {
  const normalized = normalizeModelId(model);
  return normalized === family || normalized === `${family}${ONE_M_SUFFIX}`;
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
 * Whether the model supports the `xhigh` effort level. Opus 4.7+ only — the SDK
 * silently falls back to `high` on other models.
 */
export function supportsXHighEffort(model: string): boolean {
  const normalized = normalizeModelId(model);
  if (isBuiltInFamilyVariant(normalized, 'opus')) return true;
  return /claude-opus-(4-[7-9]|[5-9])/.test(normalized);
}

/** Clamp stored effort values to what the selected model actually supports. */
export function normalizeEffortLevel(
  model: string,
  effortLevel: unknown,
): EffortLevel {
  const allowsXHigh = supportsXHighEffort(model);
  // `xhigh` and `ultracode` are both gated to xhigh-capable models (Opus 4.7+).
  const isSupported = EFFORT_LEVELS.some((level) =>
    level.value === effortLevel
    && (allowsXHigh || (level.value !== 'xhigh' && level.value !== 'ultracode'))
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

  if (has1MContextSuffix(model)) {
    return CONTEXT_WINDOW_1M;
  }

  return CONTEXT_WINDOW_STANDARD;
}
