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
});
