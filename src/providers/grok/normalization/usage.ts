import type { UsageInfo } from '../../../core/types';
import { KNOWN_GROK_MODEL_CONTEXT_WINDOWS } from '../types/models';

/**
 * Token accounting from Grok CLI headless spend fields (`usage` / `end`).
 *
 * `input_tokens` is uncached only. The context meter uses the full prompt:
 * uncached input plus both cache buckets. Output is reported separately and
 * is not added again. `reasoning_tokens` are already inside that total, so
 * they are not summed a second time. An all-zero payload means "unknown"
 * (the CLI zero-fills a missing ledger) and is rejected.
 */

export interface GrokReportedUsage {
  inputTokens: number;
  outputTokens: number;
  /** True when the payload actually carried an output-token field. */
  hasOutput: boolean;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Prompt occupancy: uncached input + cache read + cache creation. */
  contextTokens: number;
  /** `modelUsage[model].contextWindow` when the CLI sent it. */
  contextWindow: number | null;
  model: string | null;
  /** True when the CLI marked the ledger incomplete (totals may under-count). */
  incomplete: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readFirstNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = asNonNegative(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function pickModelRow(
  modelUsage: Record<string, unknown> | null,
  preferredModel: string | undefined,
): { id: string; row: Record<string, unknown> } | null {
  if (!modelUsage) {
    return null;
  }
  const preferred = preferredModel?.trim();
  if (preferred) {
    const row = asRecord(modelUsage[preferred]);
    if (row) {
      return { id: preferred, row };
    }
  }
  for (const [id, value] of Object.entries(modelUsage)) {
    const row = asRecord(value);
    if (row && (asNonNegative(row.contextWindow) !== null || asNonNegative(row.context_window) !== null)) {
      return { id, row };
    }
  }
  for (const [id, value] of Object.entries(modelUsage)) {
    const row = asRecord(value);
    if (row) {
      return { id, row };
    }
  }
  return null;
}

/**
 * Reads one `usage` or `end` object. Returns null when the ledger is missing
 * or all-zero, which the CLI uses for "unknown", not "free".
 */
export function readGrokReportedUsage(
  raw: Record<string, unknown>,
  preferredModel?: string,
): GrokReportedUsage | null {
  const usage = asRecord(raw.usage);
  const picked = pickModelRow(asRecord(raw.modelUsage), preferredModel);
  if (!usage && !picked) {
    return null;
  }

  const inputTokens = readFirstNumber(usage, ['input_tokens', 'inputTokens'])
    ?? readFirstNumber(picked?.row ?? null, ['inputTokens', 'input_tokens'])
    ?? 0;
  const outputField = readFirstNumber(usage, ['output_tokens', 'outputTokens'])
    ?? readFirstNumber(picked?.row ?? null, ['outputTokens', 'output_tokens']);
  const cacheReadTokens = readFirstNumber(usage, ['cache_read_input_tokens', 'cacheReadInputTokens'])
    ?? readFirstNumber(picked?.row ?? null, ['cacheReadInputTokens', 'cache_read_input_tokens'])
    ?? 0;
  const cacheCreationTokens = readFirstNumber(usage, ['cache_creation_input_tokens', 'cacheCreationInputTokens'])
    ?? readFirstNumber(picked?.row ?? null, ['cacheCreationInputTokens', 'cache_creation_input_tokens'])
    ?? 0;
  const splitContext = inputTokens + cacheReadTokens + cacheCreationTokens;
  const totalTokens = readFirstNumber(usage, ['total_tokens', 'totalTokens']);
  const contextTokens = splitContext > 0 ? splitContext : (totalTokens ?? 0);
  const outputTokens = outputField ?? 0;

  if (contextTokens <= 0 && outputTokens <= 0) {
    return null;
  }

  const reportedWindow = readFirstNumber(picked?.row ?? null, ['contextWindow', 'context_window']);

  return {
    inputTokens,
    outputTokens,
    hasOutput: outputField !== null,
    cacheReadTokens,
    cacheCreationTokens,
    contextTokens,
    contextWindow: reportedWindow && reportedWindow > 0 ? reportedWindow : null,
    model: picked?.id ?? (preferredModel?.trim() || null),
    incomplete: raw.usage_is_incomplete === true,
  };
}

/** True when this headless object carries a spend ledger worth keeping. */
export function grokEventHasUsage(raw: Record<string, unknown>): boolean {
  return asRecord(raw.usage) !== null || asRecord(raw.modelUsage) !== null;
}

/**
 * One final {@link UsageInfo} from a CLI ledger.
 *
 * The window is authoritative when the CLI sent `contextWindow`, or when the
 * model is one of the served ids whose 500K window we publish. An incomplete
 * ledger stays estimated: the CLI may have under-counted.
 */
export function buildGrokUsageInfo(params: {
  reported: GrokReportedUsage;
  fallbackContextWindow: number;
  model?: string;
}): UsageInfo {
  const model = params.model?.trim() || params.reported.model || undefined;
  const contextWindow = params.reported.contextWindow ?? params.fallbackContextWindow;
  const publishedWindow = model !== undefined && KNOWN_GROK_MODEL_CONTEXT_WINDOWS[model] !== undefined;
  const percentage = contextWindow > 0
    ? Math.min(100, Math.max(0, Math.round((params.reported.contextTokens / contextWindow) * 100)))
    : 0;

  return {
    inputTokens: params.reported.inputTokens,
    cacheCreationInputTokens: params.reported.cacheCreationTokens,
    cacheReadInputTokens: params.reported.cacheReadTokens,
    ...(params.reported.hasOutput ? { outputTokens: params.reported.outputTokens } : {}),
    contextTokens: params.reported.contextTokens,
    contextWindow,
    contextWindowIsAuthoritative: !params.reported.incomplete
      && contextWindow > 0
      && (params.reported.contextWindow !== null || publishedWindow),
    percentage,
    reportType: 'final',
    ...(model ? { model } : {}),
  };
}

const CONTEXT_LIMIT_STOPS = new Set([
  'max_tokens',
  'maxtokens',
  'max_output_tokens',
  'context_length_exceeded',
  'context_window_exceeded',
]);

/** Headless `end.stopReason` values that mean the context window stopped the turn. */
export function isGrokContextLimitStop(stopReason: string | null | undefined): boolean {
  const normalized = stopReason?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
  return normalized.length > 0 && CONTEXT_LIMIT_STOPS.has(normalized);
}
