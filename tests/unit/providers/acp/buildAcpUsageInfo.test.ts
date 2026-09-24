import { buildAcpUsageInfo } from '../../../../src/providers/acp';

describe('buildAcpUsageInfo', () => {
  it('combines prompt usage and context window updates', () => {
    const usage = buildAcpUsageInfo({
      contextWindow: {
        size: 200_000,
        used: 50_000,
      },
      model: 'gemini-2.5-pro',
      promptUsage: {
        cachedReadTokens: 300,
        cachedWriteTokens: 100,
        inputTokens: 1200,
        outputTokens: 400,
        totalTokens: 1900,
      },
    });

    expect(usage).toEqual({
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 300,
      contextTokens: 50_000,
      contextWindow: 200_000,
      contextWindowIsAuthoritative: true,
      inputTokens: 1200,
      model: 'gemini-2.5-pro',
      outputTokens: 400,
      percentage: 25,
    });
  });

  it('returns null when no ACP usage data exists', () => {
    expect(buildAcpUsageInfo({})).toBeNull();
  });

  it('rounds ACP usage percentages to whole numbers', () => {
    const usage = buildAcpUsageInfo({
      contextWindow: {
        size: 200_000,
        used: 11_830,
      },
      promptUsage: {
        inputTokens: 38,
        outputTokens: 175,
        totalTokens: 12_005,
      },
    });

    expect(usage?.percentage).toBe(6);
  });

  it('preserves explicit streaming accounting semantics', () => {
    expect(buildAcpUsageInfo({
      contextWindow: { size: 200_000, used: 50_000 },
      reportType: 'snapshot',
    })).toMatchObject({ reportType: 'snapshot' });
  });
});

describe('buildAcpUsageInfo consumption', () => {
  it('keeps the agent\'s window fill and books the turn total separately', () => {
    const usage = buildAcpUsageInfo({
      contextWindow: { used: 120_000, size: 400_000 } as never,
      promptUsage: { totalTokens: 2_400_000, inputTokens: 2_300_000, outputTokens: 100_000 } as never,
      reportType: 'final',
    });

    expect(usage).toEqual(expect.objectContaining({ contextTokens: 120_000, processedTokens: 2_400_000, percentage: 30 }));
  });
});
