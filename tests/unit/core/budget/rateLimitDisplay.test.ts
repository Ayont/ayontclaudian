import {
  buildRateLimitChips,
  type ClaudeWindowsInput,
  type CodexRateLimitSnapshotInput,
  formatResetIn,
  type ProviderWindowInput,
  windowLabel,
} from '@/core/budget/rateLimitDisplay';

const NOW = 1788000000000;

describe('windowLabel', () => {
  it('names the well-known subscription windows', () => {
    expect(windowLabel(300)).toBe('5h');
    expect(windowLabel(10080)).toBe('7T');
  });

  it('falls back to a generic hour label', () => {
    expect(windowLabel(720)).toBe('12h-Fenster');
    expect(windowLabel(60)).toBe('1h-Fenster');
  });
});

describe('formatResetIn', () => {
  it('formats hours and minutes', () => {
    expect(formatResetIn(NOW + (3 * 60 + 12) * 60000, NOW)).toBe('3h 12m');
    expect(formatResetIn(NOW + 45 * 60000, NOW)).toBe('45m');
  });

  it('collapses to past tense once the reset passed', () => {
    expect(formatResetIn(NOW - 1000, NOW)).toBe('Reset fällig');
  });
});

describe('buildRateLimitChips', () => {
  it('maps codex windows first, then tracker-based providers', () => {
    const codex: CodexRateLimitSnapshotInput = {
      planType: 'plus',
      windows: [{ usedPercent: 34, windowMinutes: 300, resetsAtEpochSec: Math.floor((NOW + 90 * 60000) / 1000) }],
    };
    const tracker: ProviderWindowInput = { providerId: 'claude', tokens: 40000, resetAt: NOW + 2 * 3600000 };
    const chips = buildRateLimitChips({ codex: codex, trackerWindows: [tracker], now: NOW });
    expect(chips).toEqual([
      { providerId: 'codex', label: '5h', percent: 34, resetIn: '1h 30m' },
      { providerId: 'claude', label: '5h', percent: null, tokensUsed: 40000, resetIn: '2h' },
    ]);
  });

  it('omits tracker chips without any data', () => {
    const tracker: ProviderWindowInput = { providerId: 'kimi', tokens: 0, resetAt: null };
    expect(buildRateLimitChips({ codex: null, trackerWindows: [tracker], now: NOW })).toEqual([]);
  });

  it('shows weekly codex windows with their own label', () => {
    const codex: CodexRateLimitSnapshotInput = {
      windows: [{ usedPercent: 8, windowMinutes: 10080, resetsAtEpochSec: Math.floor(NOW / 1000) + 50 * 3600 }],
    };
    const chips = buildRateLimitChips({ codex: codex, trackerWindows: [], now: NOW });
    expect(chips[0]?.label).toBe('7T');
    expect(chips[0]?.percent).toBe(8);
  });

  it('builds native claude chips for both windows', () => {
    const claude: ClaudeWindowsInput = {
      fiveHour: { tokens: 500000, resetAt: NOW + 90 * 60000 },
      weekly: { tokens: 4200000 },
    };
    const chips = buildRateLimitChips({ codex: null, claude: claude, trackerWindows: [], now: NOW });
    expect(chips).toEqual([
      { providerId: 'claude', label: '5h', percent: null, tokensUsed: 500000, resetIn: '1h 30m' },
      { providerId: 'claude', label: '7T', percent: null, tokensUsed: 4200000, resetIn: '' },
    ]);
  });

  it('computes percent when a budget is configured', () => {
    const claude: ClaudeWindowsInput = {
      fiveHour: { tokens: 250000, resetAt: NOW + 60000 },
      weekly: { tokens: 0 },
    };
    const chips = buildRateLimitChips({
      codex: null,
      claude: claude,
      trackerWindows: [],
      now: NOW,
      budgets: { claude: { fiveHour: 1000000 } },
    });
    expect(chips[0]?.percent).toBe(25);
  });
});