import {
  type CostSettings,
  estimateEventCost,
  formatCost,
  formatTokens,
  getProviderCostConfig,
  RATE_WILDCARD,
  resolveTokenRate,
  summarizeProviderCost,
  type TokenRate,
} from '../../../../src/core/budget/providerPricing';
import type { UsageEvent } from '../../../../src/core/budget/tokenBudget';

const RATE: TokenRate = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    ts: 1,
    providerId: 'claude',
    model: 'sonnet',
    tokens: 1000,
    ...overrides,
  };
}

describe('getProviderCostConfig', () => {
  test('defaults to subscription billing', () => {
    expect(getProviderCostConfig({}, 'claude').billing).toBe('subscription');
  });

  test('reads a stored metered configuration', () => {
    const settings: CostSettings = {
      providerCosts: { claude: { billing: 'metered', rates: { [RATE_WILDCARD]: RATE } } },
    };

    expect(getProviderCostConfig(settings, 'claude').billing).toBe('metered');
  });

  test('drops a negative plan price', () => {
    const settings: CostSettings = {
      providerCosts: { claude: { billing: 'subscription', monthlyCost: -5 } },
    };

    expect(getProviderCostConfig(settings, 'claude').monthlyCost).toBeUndefined();
  });
});

describe('resolveTokenRate', () => {
  test('prefers an exact model rate over the wildcard', () => {
    const config = {
      billing: 'metered' as const,
      rates: { [RATE_WILDCARD]: { input: 1, output: 1 }, sonnet: RATE },
    };

    expect(resolveTokenRate(config, 'sonnet')).toBe(RATE);
  });

  test('falls back to the wildcard rate', () => {
    const config = { billing: 'metered' as const, rates: { [RATE_WILDCARD]: RATE } };

    expect(resolveTokenRate(config, 'irgendein-modell')).toBe(RATE);
  });

  test('returns null for subscription providers and for missing rates', () => {
    expect(resolveTokenRate({ billing: 'subscription', rates: { [RATE_WILDCARD]: RATE } }, 'x')).toBeNull();
    expect(resolveTokenRate({ billing: 'metered', rates: {} }, 'x')).toBeNull();
  });
});

describe('estimateEventCost', () => {
  test('prices input, output and cache separately', () => {
    const cost = estimateEventCost(
      event({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
      RATE,
    );

    expect(cost.amount).toBeCloseTo(3 + 15 + 0.3 + 3.75);
    expect(cost.inputOnly).toBe(false);
  });

  test('bills cache at the input rate when no cache rate is configured', () => {
    const cost = estimateEventCost(
      event({ inputTokens: 0, cacheReadTokens: 1_000_000 }),
      { input: 4, output: 8 },
    );

    expect(cost.amount).toBeCloseTo(4);
  });

  test('flags an event with no reported output as input-only', () => {
    const cost = estimateEventCost(event({ inputTokens: 500_000 }), RATE);

    expect(cost.inputOnly).toBe(true);
    expect(cost.amount).toBeCloseTo(1.5);
  });

  test('falls back to the aggregate token count for legacy events', () => {
    const cost = estimateEventCost(event({ tokens: 2_000_000 }), RATE);

    expect(cost.amount).toBeCloseTo(6);
    expect(cost.inputOnly).toBe(true);
  });

  test('reports null — not zero — when no rate is configured', () => {
    expect(estimateEventCost(event(), null).amount).toBeNull();
  });
});

describe('summarizeProviderCost', () => {
  test('sums metered spend across events', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'metered', rates: { [RATE_WILDCARD]: RATE } },
      events: [
        event({ inputTokens: 1_000_000, outputTokens: 0 }),
        event({ inputTokens: 1_000_000, outputTokens: 0 }),
      ],
      providerId: 'claude',
    });

    expect(summary.meteredCost).toBeCloseTo(6);
    expect(summary.runs).toBe(2);
    expect(summary.inputTokens).toBe(2_000_000);
  });

  test('marks unpriced events instead of counting them as free', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'metered', rates: {} },
      events: [event()],
      providerId: 'claude',
    });

    expect(summary.hasUnpricedEvents).toBe(true);
    expect(summary.meteredCost).toBeNull();
  });

  test('prorates a subscription plan over the period', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'subscription', monthlyCost: 30 },
      events: [event({ tokens: 1_000_000 })],
      proratedDays: 1,
      providerId: 'claude',
    });

    expect(summary.monthlyCost).toBe(30);
    expect(summary.effectiveRatePerMillion).toBeCloseTo(1);
  });

  test('computes the effective rate a subscription really delivers', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'subscription', monthlyCost: 100 },
      events: [event({ tokens: 50_000_000 })],
      proratedDays: 30,
      providerId: 'claude',
    });

    expect(summary.effectiveRatePerMillion).toBeCloseTo(2);
  });

  test('ranks models by consumption', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'subscription' },
      events: [
        event({ model: 'haiku', tokens: 100 }),
        event({ model: 'opus', tokens: 900 }),
      ],
      providerId: 'claude',
    });

    expect(summary.models[0]).toEqual({ model: 'opus', tokens: 900 });
  });

  test('handles a provider with no events at all', () => {
    const summary = summarizeProviderCost({
      config: { billing: 'subscription' },
      events: [],
      providerId: 'grok',
    });

    expect(summary.tokens).toBe(0);
    expect(summary.effectiveRatePerMillion).toBeNull();
    expect(summary.inputOnly).toBe(false);
  });
});

describe('formatters', () => {
  test('formatTokens compacts thousands and millions', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_200)).toBe('1.2k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  test('formatCost renders an em dash for unknown amounts', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(Number.NaN)).toBe('—');
  });

  test('formatCost produces a currency string', () => {
    expect(formatCost(12.5, 'EUR')).toMatch(/12[.,]50/);
  });
});
