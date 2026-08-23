import {
  parseCodexRateLimitLine,
  pickLatestRateLimitSnapshot,
} from '@/providers/codex/runtime/rateLimits';

const SNAPSHOT_LINE = JSON.stringify({
  type: 'event_msg',
  payload: {
    rate_limits: {
      limit_id: 'codex',
      primary: { used_percent: 34, window_minutes: 10080, resets_at: 1788006652 },
      secondary: { used_percent: 12, window_minutes: 300, resets_at: 1787950000 },
      plan_type: 'plus',
    },
  },
});

describe('parseCodexRateLimitLine', () => {
  it('extracts both windows and the plan from a rate-limits line', () => {
    const snapshot = parseCodexRateLimitLine(SNAPSHOT_LINE);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.planType).toBe('plus');
    expect(snapshot?.windows).toEqual([
      { usedPercent: 34, windowMinutes: 10080, resetsAtEpochSec: 1788006652 },
      { usedPercent: 12, windowMinutes: 300, resetsAtEpochSec: 1787950000 },
    ]);
  });

  it('returns null for lines without limits or broken JSON', () => {
    expect(parseCodexRateLimitLine(JSON.stringify({ type: 'other' }))).toBeNull();
    expect(parseCodexRateLimitLine('not json at all')).toBeNull();
    expect(parseCodexRateLimitLine('')).toBeNull();
  });

  it('keeps windows with missing percent out of the list', () => {
    const line = JSON.stringify({ payload: { rate_limits: { primary: { used_percent: null, window_minutes: 300 } } } });
    const snapshot = parseCodexRateLimitLine(line);
    expect(snapshot?.windows ?? []).toHaveLength(0);
  });
});

describe('pickLatestRateLimitSnapshot', () => {
  it('prefers the last line that carries a snapshot', () => {
    const older = SNAPSHOT_LINE.replace('34', '10');
    const lines = ['{"type":"other"}', older, 'garbage', SNAPSHOT_LINE];
    expect(pickLatestRateLimitSnapshot(lines)?.windows[0]?.usedPercent).toBe(34);
  });

  it('returns null when nothing matches', () => {
    expect(pickLatestRateLimitSnapshot(['x', 'y'])).toBeNull();
  });
});