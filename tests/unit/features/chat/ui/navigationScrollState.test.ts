import {
  AT_BOTTOM_THRESHOLD_PX,
  awayThreshold,
  distanceFromBottom,
  MIN_AWAY_DISTANCE_PX,
  resolveNavScrollState,
} from '@/features/chat/ui/navigationScrollState';

const metrics = (scrollTop: number, scrollHeight = 3000, clientHeight = 600) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

describe('navigationScrollState', () => {
  it('measures the distance to the bottom and never reports a negative value', () => {
    expect(distanceFromBottom(metrics(2400))).toBe(0);
    expect(distanceFromBottom(metrics(2000))).toBe(400);
    // Elastic overscroll can push scrollTop past the end.
    expect(distanceFromBottom(metrics(2450))).toBe(0);
  });

  it('uses a third of the viewport as the away threshold, with a floor for short panes', () => {
    expect(awayThreshold(900)).toBe(300);
    expect(awayThreshold(200)).toBe(MIN_AWAY_DISTANCE_PX);
  });

  it('is not scrollable when the content barely overflows', () => {
    const state = resolveNavScrollState(metrics(0, 640, 600), false);
    expect(state).toEqual({ scrollable: false, atBottom: false, away: false });
  });

  it('stays calm near the bottom and only turns away beyond a viewport third', () => {
    expect(resolveNavScrollState(metrics(2400 - AT_BOTTOM_THRESHOLD_PX), false)).toEqual({
      scrollable: true,
      atBottom: true,
      away: false,
    });
    // 150px up: no longer at the bottom, but not far enough for the pill.
    expect(resolveNavScrollState(metrics(2250), false)).toEqual({
      scrollable: true,
      atBottom: false,
      away: false,
    });
    expect(resolveNavScrollState(metrics(2099), false).away).toBe(true);
  });

  it('keeps the away state until the bottom is reached, so compaction cannot flicker', () => {
    // Once away, scrolling back to 150px from the bottom must not hide the pill…
    expect(resolveNavScrollState(metrics(2250), true).away).toBe(true);
    // …only arriving at the bottom does.
    expect(resolveNavScrollState(metrics(2395), true).away).toBe(false);
  });

  it('drops the away state when the content stops overflowing', () => {
    expect(resolveNavScrollState(metrics(0, 600, 600), true).away).toBe(false);
  });
});
