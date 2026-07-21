import { TokenBudgetTracker } from '../../../../src/core/budget/tokenBudget';
import type { UsageInfo } from '../../../../src/core/types';

function makeUsage(contextTokens: number, inputTokens = 0): UsageInfo {
  return {
    contextTokens,
    inputTokens: inputTokens || contextTokens,
    contextWindow: 200_000,
    percentage: 0,
  };
}

describe('TokenBudgetTracker', () => {
  it('tracks usage into daily and session totals', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(100));
    tracker.trackUsage(makeUsage(50));
    const state = tracker.getState();
    expect(state.dailyTotal).toBe(150);
    expect(state.sessionTotal).toBe(150);
  });

  it('tracks provider and model breakdowns', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage({ ...makeUsage(120), model: 'gpt-5.6' }, 'codex');
    tracker.trackUsage({ ...makeUsage(80), model: 'gpt-5.6' }, 'codex');
    expect(tracker.getState().breakdown['codex:gpt-5.6']).toEqual({ tokens: 200, runs: 2 });
  });

  it('allows turns when budgets are not configured', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(1_000_000));
    const check = tracker.checkBudget({ tokenBudgetEnabled: true });
    expect(check.ok).toBe(true);
  });

  it('blocks when daily budget is reached', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(500));
    const check = tracker.checkBudget({ tokenBudgetEnabled: true, dailyTokenBudget: 500 });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Daily token budget reached');
  });

  it('blocks when session budget is reached', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(300));
    const check = tracker.checkBudget({ tokenBudgetEnabled: true, sessionTokenBudget: 300 });
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('Session token budget reached');
  });

  it('resets session total independently', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(100));
    tracker.resetSession();
    expect(tracker.getState().sessionTotal).toBe(0);
    expect(tracker.getState().dailyTotal).toBe(100);
  });

  it('resets daily total independently', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(100));
    tracker.resetDaily();
    expect(tracker.getState().dailyTotal).toBe(0);
    expect(tracker.getState().sessionTotal).toBe(100);
  });

  it('falls back to inputTokens when contextTokens is zero', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(0, 75));
    expect(tracker.getState().dailyTotal).toBe(75);
  });

  it('ignores zero/negative usage', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage(makeUsage(0, 0));
    expect(tracker.getState().dailyTotal).toBe(0);
  });

  // ── Rate-limit windows (Verbrauch & Limits) ──────────────────────────

  const HOUR = 60 * 60 * 1000;

  function seedTracker(events: Array<{ ts: number; providerId: string; tokens: number }>): TokenBudgetTracker {
    return new TokenBudgetTracker({
      dailyTotal: 0,
      sessionTotal: 0,
      lastResetDay: 'seeded',
      breakdown: {},
      events: events.map((event) => ({ ...event, model: 'm' })),
    });
  }

  it('aggregates the window per provider with reset from the oldest in-window event', () => {
    const now = Date.now();
    const tracker = seedTracker([
      { ts: now - 1 * HOUR, providerId: 'claude', tokens: 10_000 },
      { ts: now - 2 * HOUR, providerId: 'claude', tokens: 5_000 },
      { ts: now - 6 * HOUR, providerId: 'claude', tokens: 99_999 }, // outside the 5h window
      { ts: now - 30 * 60 * 1000, providerId: 'kimi', tokens: 2_000 },
    ]);
    const win = tracker.getProviderWindow('claude', 5, now);
    expect(win.tokens).toBe(15_000);
    expect(win.runs).toBe(2);
    // Claude-Code semantics: window starts at the FIRST event and resets 5h later.
    expect(win.resetAt).toBe(now - 2 * HOUR + 5 * HOUR);
  });

  it('reports a null resetAt when the window is empty', () => {
    const now = Date.now();
    const tracker = seedTracker([
      { ts: now - 8 * HOUR, providerId: 'claude', tokens: 1_000 },
    ]);
    const win = tracker.getProviderWindow('claude', 5, now);
    expect(win.tokens).toBe(0);
    expect(win.resetAt).toBeNull();
  });

  it('separates today and 7-day sums from the window', () => {
    const now = Date.now();
    const tracker = seedTracker([
      { ts: now - 30 * 60 * 1000, providerId: 'kimi', tokens: 1_000 }, // today + window + week
      { ts: now - 26 * HOUR, providerId: 'kimi', tokens: 2_000 },       // week only (yesterday)
      { ts: now - 3 * 24 * HOUR, providerId: 'kimi', tokens: 4_000 },   // week only
      { ts: now - 10 * 24 * HOUR, providerId: 'kimi', tokens: 8_000 },  // pruned from events? no — seeded directly, but older than retention: must be ignored by week math via ts filter
    ]);
    const win = tracker.getProviderWindow('kimi', 5, now);
    expect(win.todayTokens).toBe(1_000);
    expect(win.weekTokens).toBe(7_000);
  });

  it('getWindowedProviders sorts by window tokens and honors custom window hours', () => {
    const now = Date.now();
    const tracker = seedTracker([
      { ts: now - 1 * HOUR, providerId: 'claude', tokens: 5_000 },
      { ts: now - 10 * HOUR, providerId: 'kimi', tokens: 20_000 },
    ]);
    // Kimi's event is 10h old — inside a custom 24h window, outside the default 5h.
    const windows = tracker.getWindowedProviders({ kimi: 24 }, now);
    expect(windows[0].providerId).toBe('kimi');
    expect(windows[0].tokens).toBe(20_000);
    expect(windows[0].resetAt).toBe(now - 10 * HOUR + 24 * HOUR);
    expect(windows[1].providerId).toBe('claude');
  });

  it('trackUsage appends events and resets clear them', () => {
    const tracker = new TokenBudgetTracker();
    tracker.trackUsage({ ...makeUsage(100), model: 'm' }, 'claude');
    expect(tracker.getState().events).toHaveLength(1);
    expect(tracker.getState().events?.[0].providerId).toBe('claude');
    tracker.resetDaily();
    expect(tracker.getState().events).toHaveLength(0);
  });

  it('prunes events beyond retention and the max cap', () => {
    const now = Date.now();
    const events = Array.from({ length: 3_100 }, (_, i) => ({
      ts: now - i * 1000,
      providerId: 'claude',
      model: 'm',
      tokens: 1,
    }));
    const tracker = new TokenBudgetTracker({
      dailyTotal: 0, sessionTotal: 0, lastResetDay: 'seeded', breakdown: {}, events,
    });
    tracker.trackUsage(makeUsage(1), 'claude');
    expect(tracker.getState().events!.length).toBeLessThanOrEqual(3_000);
  });
});
