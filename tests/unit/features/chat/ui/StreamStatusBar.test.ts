import { formatElapsed } from '@/features/chat/ui/StreamStatusBar';

describe('formatElapsed', () => {
  it('shows seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(1500)).toBe('1s');
    expect(formatElapsed(59_000)).toBe('59s');
  });

  it('shows M:SS at and beyond a minute', () => {
    expect(formatElapsed(60_000)).toBe('1:00');
    expect(formatElapsed(75_000)).toBe('1:15');
    expect(formatElapsed(605_000)).toBe('10:05');
  });

  it('clamps negative input to 0s', () => {
    expect(formatElapsed(-1000)).toBe('0s');
  });
});
