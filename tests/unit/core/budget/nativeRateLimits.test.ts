import { NativeRateLimitStore } from '@/core/budget/nativeRateLimits';

describe('NativeRateLimitStore', () => {
  it('keeps one window per window length, the latest report winning', () => {
    const store = new NativeRateLimitStore();
    store.record('claude', { window: { usedPercent: 10, windowMinutes: 300, resetsAtEpochSec: 100 }, rejected: false, resetsAtEpochSec: 100 });
    store.record('claude', { window: { usedPercent: 60, windowMinutes: 10080, resetsAtEpochSec: 900 }, rejected: false, resetsAtEpochSec: 900 });
    store.record('claude', { window: { usedPercent: 25, windowMinutes: 300, resetsAtEpochSec: 100 }, rejected: false, resetsAtEpochSec: 100 });

    expect(store.get('claude')).toEqual({
      windows: [
        { usedPercent: 25, windowMinutes: 300, resetsAtEpochSec: 100 },
        { usedPercent: 60, windowMinutes: 10080, resetsAtEpochSec: 900 },
      ],
    });
  });

  it('does not invent a window for a report without utilization', () => {
    const store = new NativeRateLimitStore();
    store.record('claude', { window: null, rejected: true, resetsAtEpochSec: 500 });

    expect(store.get('claude')).toBeNull();
    expect(store.snapshot()).toEqual({});
  });

  it('keeps providers apart', () => {
    const store = new NativeRateLimitStore();
    store.record('claude', { window: { usedPercent: 5, windowMinutes: 300, resetsAtEpochSec: 1 }, rejected: false, resetsAtEpochSec: 1 });

    expect(store.get('codex')).toBeNull();
    expect(Object.keys(store.snapshot())).toEqual(['claude']);
  });
});
