import { appendActivity, formatElapsed, type StreamActivity } from '@/features/chat/ui/StreamStatusBar';

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

describe('appendActivity', () => {
  const activity = (primary: string, meta = '', at = 0): StreamActivity => ({ primary, meta, at });

  it('keeps distinct provider transitions in chronological order', () => {
    const activities = appendActivity(
      appendActivity([], activity('Model is reasoning', 'Thinking stream', 10)),
      activity('Read file', 'CLAUDE.md', 20),
    );

    expect(activities).toEqual([
      activity('Model is reasoning', 'Thinking stream', 10),
      activity('Read file', 'CLAUDE.md', 20),
    ]);
  });

  it('deduplicates repetitive streaming events', () => {
    const first = appendActivity([], activity('Writing response', 'Assistant text stream', 10));
    const next = appendActivity(first, activity('Writing response', 'Assistant text stream', 20));

    expect(next).toEqual([activity('Writing response', 'Assistant text stream', 10)]);
  });

  it('keeps the newest activities within the requested bound', () => {
    const activities = ['one', 'two', 'three'].reduce(
      (history, primary, index) => appendActivity(history, activity(primary, '', index), 2),
      [] as StreamActivity[],
    );

    expect(activities.map(entry => entry.primary)).toEqual(['two', 'three']);
  });
});
