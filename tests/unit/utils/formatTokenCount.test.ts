import { formatTokenCount } from '@/utils/formatTokenCount';

describe('formatTokenCount', () => {
  it.each([
    [0, '0'],
    [500, '500'],
    [1_500, '1.5k'],
    [50_000, '50k'],
    [170_000, '170k'],
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
    [2_000_000_000, '2B'],
  ])('%d → %s', (tokens, expected) => {
    expect(formatTokenCount(tokens)).toBe(expected);
  });

  it('never renders a negative or non-finite count', () => {
    expect(formatTokenCount(-5)).toBe('0');
    expect(formatTokenCount(Number.NaN)).toBe('0');
  });
});
