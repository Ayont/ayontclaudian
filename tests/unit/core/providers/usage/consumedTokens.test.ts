import { consumedTokens, isPlausibleContextUsage, usageAfterCompaction } from '@/core/providers/usage/consumedTokens';

describe('consumedTokens', () => {
  it('counts what all calls of a turn processed, not just the window fill', () => {
    expect(consumedTokens({ contextTokens: 180_000, processedTokens: 4_200_000, inputTokens: 300 })).toBe(4_200_000);
  });

  it('falls back to the context reading, then to input tokens', () => {
    expect(consumedTokens({ contextTokens: 900, inputTokens: 40 })).toBe(900);
    expect(consumedTokens({ contextTokens: 0, inputTokens: 40 })).toBe(40);
  });
});

describe('isPlausibleContextUsage', () => {
  it('rejects a reading above its window', () => {
    expect(isPlausibleContextUsage({ contextTokens: 30_688_792, contextWindow: 1_000_000 })).toBe(false);
    expect(isPlausibleContextUsage({ contextTokens: 640_000, contextWindow: 1_000_000 })).toBe(true);
    expect(isPlausibleContextUsage({ contextTokens: 0, contextWindow: 1_000_000 })).toBe(false);
    expect(isPlausibleContextUsage(null)).toBe(false);
  });
});

describe('usageAfterCompaction', () => {
  const before = {
    model: 'm',
    inputTokens: 150_000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    contextWindow: 200_000,
    contextTokens: 180_000,
    processedTokens: 900_000,
    percentage: 90,
  };

  it('shows the size the provider reports after compacting', () => {
    expect(usageAfterCompaction(before, 24_000)).toMatchObject({
      contextTokens: 24_000,
      contextWindow: 200_000,
      percentage: 12,
    });
    expect(usageAfterCompaction(before, 24_000)).not.toHaveProperty('processedTokens');
  });

  it('drops a pre-compaction reading when the new size is unknown', () => {
    expect(usageAfterCompaction(before)).toBeNull();
  });

  it('stays empty without a reading or a window', () => {
    expect(usageAfterCompaction(null, 10_000)).toBeNull();
    expect(usageAfterCompaction({ ...before, contextWindow: 0 }, 10_000)).toBeNull();
  });
});
