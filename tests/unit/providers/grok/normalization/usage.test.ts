import { buildGrokUsageInfo, isGrokContextLimitStop, readGrokReportedUsage } from '@/providers/grok/normalization/usage';

describe('readGrokReportedUsage', () => {
  const endEvent = {
    type: 'end',
    stopReason: 'end_turn',
    usage: {
      input_tokens: 7210,
      cache_read_input_tokens: 41000,
      cache_creation_input_tokens: 120,
      output_tokens: 1893,
      reasoning_tokens: 412,
      total_tokens: 50223,
    },
    modelUsage: {
      'grok-4.7': {
        inputTokens: 7210,
        outputTokens: 1893,
        cacheReadInputTokens: 41000,
        contextWindow: 500000,
      },
    },
  };

  it('counts the full prompt, not uncached input alone, and keeps the CLI window', () => {
    const reported = readGrokReportedUsage(endEvent, 'grok-4.7');
    expect(reported).toMatchObject({
      inputTokens: 7210,
      outputTokens: 1893,
      hasOutput: true,
      cacheReadTokens: 41000,
      cacheCreationTokens: 120,
      contextTokens: 7210 + 41000 + 120,
      contextWindow: 500000,
      model: 'grok-4.7',
      incomplete: false,
    });
  });

  it('does not add reasoning tokens on top of the ledger total', () => {
    const reported = readGrokReportedUsage(endEvent, 'grok-4.7');
    expect(reported?.contextTokens).toBe(48330);
    expect(reported?.contextTokens).not.toBe(48330 + 412);
  });

  it('treats an all-zero ledger as unknown', () => {
    expect(readGrokReportedUsage({
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    })).toBeNull();
  });

  it('builds an authoritative meter against the 500K window', () => {
    const reported = readGrokReportedUsage(endEvent, 'grok-4.7');
    expect(reported).not.toBeNull();
    const usage = buildGrokUsageInfo({
      reported: reported!,
      fallbackContextWindow: 500_000,
      model: 'grok-4.7',
    });
    expect(usage.contextWindow).toBe(500_000);
    expect(usage.contextWindowIsAuthoritative).toBe(true);
    expect(usage.contextTokens).toBe(48330);
    expect(usage.percentage).toBe(10);
    expect(usage.outputTokens).toBe(1893);
    expect(usage.reportType).toBe('final');
  });

  it('keeps an incomplete ledger estimated even when a window is present', () => {
    const reported = readGrokReportedUsage({ ...endEvent, usage_is_incomplete: true }, 'grok-4.7');
    const usage = buildGrokUsageInfo({
      reported: reported!,
      fallbackContextWindow: 500_000,
      model: 'grok-4.7',
    });
    expect(usage.contextWindowIsAuthoritative).toBe(false);
  });

  it('recognizes a context-limit stop without treating a normal end as one', () => {
    expect(isGrokContextLimitStop('max_tokens')).toBe(true);
    expect(isGrokContextLimitStop('EndTurn')).toBe(false);
    expect(isGrokContextLimitStop('end_turn')).toBe(false);
  });
});
