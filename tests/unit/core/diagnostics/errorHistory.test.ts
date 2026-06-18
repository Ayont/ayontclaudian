import {
  clearErrorHistory,
  ERROR_HISTORY_LIMIT,
  getErrorHistory,
  recordProviderError,
} from '@/core/diagnostics/errorHistory';

describe('errorHistory', () => {
  beforeEach(() => clearErrorHistory());

  it('records provider errors newest-last', () => {
    recordProviderError('claude', 'first', 1);
    recordProviderError('vibe', 'second', 2);
    const history = getErrorHistory();
    expect(history).toEqual([
      { timestamp: 1, providerId: 'claude', message: 'first' },
      { timestamp: 2, providerId: 'vibe', message: 'second' },
    ]);
  });

  it('collapses whitespace and ignores empty messages', () => {
    recordProviderError('claude', '  line one\n   line two  ', 1);
    recordProviderError('claude', '   ', 2);
    const history = getErrorHistory();
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe('line one line two');
  });

  it('caps the buffer at the limit, dropping the oldest', () => {
    for (let i = 0; i < ERROR_HISTORY_LIMIT + 5; i++) {
      recordProviderError('claude', `e${i}`, i);
    }
    const history = getErrorHistory();
    expect(history).toHaveLength(ERROR_HISTORY_LIMIT);
    expect(history[0].message).toBe('e5');
    expect(history.at(-1)?.message).toBe(`e${ERROR_HISTORY_LIMIT + 4}`);
  });

  it('getErrorHistory returns a copy (no external mutation)', () => {
    recordProviderError('claude', 'x', 1);
    const history = getErrorHistory();
    history.push({ timestamp: 9, providerId: 'z', message: 'mutated' });
    expect(getErrorHistory()).toHaveLength(1);
  });
});
