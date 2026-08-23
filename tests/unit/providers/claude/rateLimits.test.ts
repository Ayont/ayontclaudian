import {
  buildClaudeWindows,
  parseClaudeUsageLine,
} from '@/providers/claude/runtime/rateLimits';

const NOW = Date.parse('2026-08-22T21:00:00.000Z');

function usageLine(atIso: string, tokens: Partial<{ input: number; output: number; cacheRead: number; cacheCreation: number }>): string {
  return JSON.stringify({
    timestamp: atIso,
    message: { role: 'assistant', usage: {
      input_tokens: tokens.input ?? 0,
      output_tokens: tokens.output ?? 0,
      cache_read_input_tokens: tokens.cacheRead ?? 0,
      cache_creation_input_tokens: tokens.cacheCreation ?? 0,
    } },
  });
}

describe('parseClaudeUsageLine', () => {
  it('sums all four token buckets with the timestamp', () => {
    const event = parseClaudeUsageLine(usageLine('2026-08-22T20:00:00.000Z', { input: 10, output: 5, cacheRead: 100, cacheCreation: 15 }));
    expect(event).toEqual({ atMs: Date.parse('2026-08-22T20:00:00.000Z'), tokens: 130 });
  });

  it('ignores user lines and broken json', () => {
    expect(parseClaudeUsageLine(JSON.stringify({ type: 'user' }))).toBeNull();
    expect(parseClaudeUsageLine('nope')).toBeNull();
  });
});

describe('buildClaudeWindows', () => {
  const events = [
    { atMs: NOW - 6 * 3600_000, tokens: 500 },   // outside the 5h window, inside the week
    { atMs: NOW - 4 * 3600_000, tokens: 200 },   // oldest inside the 5h window
    { atMs: NOW - 30 * 60_000, tokens: 300 },
  ];

  it('splits the rolling 5h window and the 7 day week', () => {
    const windows = buildClaudeWindows(events, NOW);
    expect(windows.fiveHour.tokens).toBe(500);
    expect(windows.fiveHour.resetAt).toBe(NOW - 4 * 3600_000 + 5 * 3600_000);
    expect(windows.weekly.tokens).toBe(1000);
  });

  it('reports no reset when the window is empty', () => {
    expect(buildClaudeWindows([], NOW).fiveHour.resetAt).toBeNull();
  });
});