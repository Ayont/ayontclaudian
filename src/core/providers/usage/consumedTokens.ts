import type { UsageInfo } from '../../types';

/**
 * Tokens a usage report adds to consumption. `contextTokens` is how full the
 * window is (the latest call); a turn with many calls consumed more than that.
 */
export function consumedTokens(usage: Pick<UsageInfo, 'processedTokens' | 'contextTokens' | 'inputTokens'>): number {
  if (typeof usage.processedTokens === 'number' && usage.processedTokens > 0) {
    return usage.processedTokens;
  }
  return usage.contextTokens > 0 ? usage.contextTokens : usage.inputTokens;
}

/**
 * A context reading that exceeds its window is a sum, not an occupancy (older
 * builds stored those). It must not drive the meter, a warning or a footer.
 */
export function isPlausibleContextUsage(usage: Pick<UsageInfo, 'contextTokens' | 'contextWindow'> | null | undefined): boolean {
  if (!usage || usage.contextWindow <= 0 || usage.contextTokens <= 0) return false;
  return usage.contextTokens <= usage.contextWindow * 1.05;
}

/**
 * The context reading once the provider compacted. The pre-compaction fill is
 * wrong from here on; the new size is shown when the provider states it, and
 * otherwise nothing until its next report.
 */
export function usageAfterCompaction(usage: UsageInfo | null, tokensAfter?: number): UsageInfo | null {
  if (!usage || usage.contextWindow <= 0) return null;
  if (typeof tokensAfter !== 'number' || !Number.isFinite(tokensAfter) || tokensAfter < 0) return null;
  const { processedTokens: _processed, ...rest } = usage;
  const percentage = Math.min(100, Math.max(0, Math.round((tokensAfter / usage.contextWindow) * 100)));
  return { ...rest, contextTokens: tokensAfter, percentage };
}
