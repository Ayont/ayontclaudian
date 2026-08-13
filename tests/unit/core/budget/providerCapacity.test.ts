import {
  CAPACITY_LOW_THRESHOLD,
  distributeAcrossProviders,
  formatCapacityReset,
  type ProviderCapacityInput,
  rankProviderCapacities,
  scoreProviderCapacity,
} from '../../../../src/core/budget/providerCapacity';
import type { ProviderWindow } from '../../../../src/core/budget/tokenBudget';

const NOW = 1_700_000_000_000;

function makeWindow(tokens: number, resetAt: number | null = null): ProviderWindow {
  return { providerId: 'x', tokens, runs: 1, todayTokens: tokens, weekTokens: tokens, resetAt };
}

function input(overrides: Partial<ProviderCapacityInput> = {}): ProviderCapacityInput {
  return {
    providerId: 'claude',
    enabled: true,
    window: makeWindow(0),
    cap: 0,
    ...overrides,
  };
}

describe('scoreProviderCapacity', () => {
  test('treats an uncapped provider as fully available', () => {
    const capacity = scoreProviderCapacity(input({ window: makeWindow(500_000) }), NOW);

    expect(capacity.available).toBe(true);
    expect(capacity.headroom).toBe(1);
    expect(capacity.reason).toBe('frei');
  });

  test('computes headroom against a configured cap', () => {
    const capacity = scoreProviderCapacity(input({ cap: 1_000_000, window: makeWindow(250_000) }), NOW);

    expect(capacity.headroom).toBeCloseTo(0.75);
    expect(capacity.available).toBe(true);
  });

  test('marks a provider at its cap as unavailable', () => {
    const capacity = scoreProviderCapacity(input({ cap: 100_000, window: makeWindow(100_000) }), NOW);

    expect(capacity.available).toBe(false);
    expect(capacity.reason).toBe('Limit erreicht');
  });

  test('flags a nearly exhausted provider as low but usable', () => {
    const capacity = scoreProviderCapacity(input({ cap: 100_000, window: makeWindow(90_000) }), NOW);

    expect(capacity.available).toBe(true);
    expect(capacity.headroom).toBeLessThanOrEqual(CAPACITY_LOW_THRESHOLD);
    expect(capacity.reason).toBe('wenig Kontingent');
  });

  test('respects an active rate-limit cooldown', () => {
    const capacity = scoreProviderCapacity(input({ cooldownUntil: NOW + 60_000 }), NOW);

    expect(capacity.available).toBe(false);
    expect(capacity.reason).toBe('Rate-Limit');
  });

  test('ignores an expired cooldown', () => {
    const capacity = scoreProviderCapacity(input({ cooldownUntil: NOW - 60_000 }), NOW);

    expect(capacity.available).toBe(true);
    expect(capacity.cooldownUntil).toBeNull();
  });

  test('a disabled provider is never available', () => {
    const capacity = scoreProviderCapacity(input({ enabled: false }), NOW);

    expect(capacity.available).toBe(false);
    expect(capacity.reason).toBe('deaktiviert');
  });
});

describe('rankProviderCapacities', () => {
  test('puts available providers first, best headroom leading', () => {
    const ranked = rankProviderCapacities(
      [
        input({ providerId: 'a', cap: 100_000, window: makeWindow(90_000) }),
        input({ providerId: 'b', enabled: false }),
        input({ providerId: 'c', cap: 100_000, window: makeWindow(10_000) }),
      ],
      NOW,
    );

    expect(ranked.map((capacity) => capacity.providerId)).toEqual(['c', 'a', 'b']);
  });

  test('prefers the least-used provider when nothing has a cap', () => {
    const ranked = rankProviderCapacities(
      [
        input({ providerId: 'busy', window: makeWindow(800_000) }),
        input({ providerId: 'idle', window: makeWindow(0) }),
      ],
      NOW,
    );

    expect(ranked[0].providerId).toBe('idle');
  });
});

describe('distributeAcrossProviders', () => {
  test('round-robins across available providers', () => {
    const ranked = rankProviderCapacities(
      [input({ providerId: 'a' }), input({ providerId: 'b' })],
      NOW,
    );

    expect(distributeAcrossProviders(ranked, 5)).toHaveLength(5);
    expect(new Set(distributeAcrossProviders(ranked, 4)).size).toBe(2);
  });

  test('falls back to blocked providers rather than dispatching nowhere', () => {
    const ranked = rankProviderCapacities([input({ providerId: 'a', enabled: false })], NOW);

    expect(distributeAcrossProviders(ranked, 2)).toEqual(['a', 'a']);
  });

  test('returns nothing for an empty pool or zero items', () => {
    expect(distributeAcrossProviders([], 3)).toEqual([]);
    expect(distributeAcrossProviders(rankProviderCapacities([input()], NOW), 0)).toEqual([]);
  });
});

describe('formatCapacityReset', () => {
  test('formats minutes and hours, and elides past timestamps', () => {
    expect(formatCapacityReset(NOW + 30 * 60_000, NOW)).toBe('30 min');
    expect(formatCapacityReset(NOW + 150 * 60_000, NOW)).toBe('2 h 30 min');
    expect(formatCapacityReset(NOW + 120 * 60_000, NOW)).toBe('2 h');
    expect(formatCapacityReset(NOW - 1000, NOW)).toBe('—');
    expect(formatCapacityReset(null, NOW)).toBe('—');
  });
});
