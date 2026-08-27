import {
  buildEstimatedUsageInfo,
  estimateTokens,
  estimateTokensForTexts,
} from '@/core/providers/usage/estimateUsage';

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~4 characters per token (rounded up)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});

describe('estimateTokensForTexts', () => {
  it('sums fragments and ignores empty/nullish', () => {
    expect(estimateTokensForTexts(['abcd', null, undefined, 'abcd'])).toBe(2);
  });
});

describe('buildEstimatedUsageInfo', () => {
  it('computes a clamped percentage and marks the window non-authoritative', () => {
    const usage = buildEstimatedUsageInfo({
      contextTokens: 50_000,
      contextWindow: 200_000,
      model: 'kimi-code/kimi-for-coding',
    });
    expect(usage).toMatchObject({
      contextTokens: 50_000,
      inputTokens: 50_000,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: false,
      percentage: 25,
      model: 'kimi-code/kimi-for-coding',
    });
  });

  it('clamps percentage to 100 when over the window', () => {
    expect(buildEstimatedUsageInfo({ contextTokens: 300_000, contextWindow: 200_000 }).percentage).toBe(100);
  });

  it('reports 0% when the window is unknown (0)', () => {
    expect(buildEstimatedUsageInfo({ contextTokens: 10, contextWindow: 0 }).percentage).toBe(0);
  });

  it('omits the model field when not provided', () => {
    expect(buildEstimatedUsageInfo({ contextTokens: 10, contextWindow: 100 })).not.toHaveProperty('model');
  });

  it('preserves explicit streaming accounting semantics', () => {
    expect(buildEstimatedUsageInfo({
      contextTokens: 10,
      contextWindow: 100,
      reportType: 'snapshot',
    })).toMatchObject({ reportType: 'snapshot' });
  });
});
