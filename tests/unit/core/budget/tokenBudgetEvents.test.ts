import { TokenBudgetTracker } from '../../../../src/core/budget/tokenBudget';
import type { UsageInfo } from '../../../../src/core/types';

function usage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    contextTokens: 1000,
    contextWindow: 200_000,
    inputTokens: 800,
    percentage: 1,
    ...overrides,
  };
}

describe('TokenBudgetTracker itemized events', () => {
  test('records the reported input/output/cache split', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(
      usage({
        cacheCreationInputTokens: 300,
        cacheReadInputTokens: 200,
        inputTokens: 800,
        model: 'sonnet',
        outputTokens: 400,
      }),
      'claude',
    );

    const [event] = tracker.getEvents();
    expect(event).toMatchObject({
      cacheReadTokens: 200,
      cacheWriteTokens: 300,
      inputTokens: 800,
      outputTokens: 400,
      providerId: 'claude',
    });
  });

  test('omits fields the provider never reported', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(usage(), 'grok');

    const [event] = tracker.getEvents();
    expect(event.outputTokens).toBeUndefined();
    expect(event.cacheReadTokens).toBeUndefined();
    expect(event.inputTokens).toBe(800);
  });
});

describe('TokenBudgetTracker queries', () => {
  test('filters events by provider', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(usage(), 'claude');
    tracker.trackUsage(usage(), 'codex');

    expect(tracker.getEvents({ providerId: 'codex' })).toHaveLength(1);
    expect(tracker.getEvents()).toHaveLength(2);
  });

  test('filters events by start time', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(usage(), 'claude');

    expect(tracker.getEvents({ since: Date.now() + 60_000 })).toHaveLength(0);
    expect(tracker.getEvents({ since: Date.now() - 60_000 })).toHaveLength(1);
  });

  test('lists every provider that recorded usage', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(usage(), 'claude');
    tracker.trackUsage(usage(), 'claude');
    tracker.trackUsage(usage(), 'kimi');

    expect(tracker.getSeenProviderIds().sort()).toEqual(['claude', 'kimi']);
  });
});

describe('TokenBudgetTracker.getDailySeries', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function trackerWithEvents(events: { ts: number; providerId: string; tokens: number }[]): TokenBudgetTracker {
    return new TokenBudgetTracker({
      breakdown: {},
      dailyTotal: 0,
      events: events.map((event) => ({ ...event, model: 'default' })),
      lastResetDay: '2026-01-01',
      sessionTotal: 0,
    });
  }

  test('puts today in the last bucket', () => {
    const now = Date.now();
    const series = trackerWithEvents([{ providerId: 'claude', tokens: 500, ts: now }])
      .getDailySeries('claude', 7, now);

    expect(series).toHaveLength(7);
    expect(series[6]).toBe(500);
    expect(series.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test('buckets an event from two days ago correctly', () => {
    const now = Date.now();
    const series = trackerWithEvents([{ providerId: 'claude', tokens: 300, ts: now - 2 * DAY_MS }])
      .getDailySeries('claude', 7, now);

    expect(series[4]).toBe(300);
  });

  test('ignores events outside the requested span', () => {
    const now = Date.now();
    const series = trackerWithEvents([{ providerId: 'claude', tokens: 900, ts: now - 10 * DAY_MS }])
      .getDailySeries('claude', 3, now);

    expect(series).toEqual([0, 0, 0]);
  });

  test('aggregates across providers when none is specified', () => {
    const now = Date.now();
    const series = trackerWithEvents([
      { providerId: 'claude', tokens: 100, ts: now },
      { providerId: 'codex', tokens: 200, ts: now },
    ]).getDailySeries(null, 2, now);

    expect(series[1]).toBe(300);
  });

  test('always returns at least one bucket', () => {
    expect(new TokenBudgetTracker().getDailySeries(null, 0)).toHaveLength(1);
  });
});
