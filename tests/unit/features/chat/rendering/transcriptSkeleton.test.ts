import { createMockEl } from '@test/helpers/mockElement';

import { scheduleTranscriptSkeleton,SKELETON_DELAY_MS } from '@/features/chat/rendering/transcriptSkeleton';

describe('scheduleTranscriptSkeleton', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // A tab that loads in a blink must not flash a placeholder.
  it('shows nothing when the load finishes quickly', () => {
    const messagesEl = createMockEl();
    const done = scheduleTranscriptSkeleton(messagesEl as never);

    jest.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    done();
    jest.advanceTimersByTime(1_000);

    expect(messagesEl.querySelector('.claudian-transcript-skeleton')).toBeNull();
  });

  it('shows a labelled placeholder while a slow load runs and removes it after', () => {
    const messagesEl = createMockEl();
    const done = scheduleTranscriptSkeleton(messagesEl as never);

    jest.advanceTimersByTime(SKELETON_DELAY_MS);
    const skeleton = messagesEl.querySelector('.claudian-transcript-skeleton') as any;
    expect(skeleton).not.toBeNull();
    expect(skeleton.getAttribute('aria-label')).toBe('Unterhaltung wird geladen');

    done();
    expect(messagesEl.querySelector('.claudian-transcript-skeleton')).toBeNull();
  });
});
