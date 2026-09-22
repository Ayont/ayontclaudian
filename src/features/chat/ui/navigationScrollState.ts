/**
 * Pure scroll-position model for the chat navigation: the arrow rail, the
 * centered "Zum Ende" pill, and the compact chat chrome while reading history.
 */

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface NavScrollState {
  /** The transcript overflows enough to be worth navigating. */
  scrollable: boolean;
  /** Close enough to the end that "down" actions have nothing left to do. */
  atBottom: boolean;
  /** Far enough up that the pill and the compact chrome take over. */
  away: boolean;
}

/** Overflow smaller than this is not worth showing navigation for. */
export const SCROLLABLE_BUFFER_PX = 50;
/** Mirrors the auto-scroll "at bottom" threshold in Tab.ts, so both agree on "at the end". */
export const AT_BOTTOM_THRESHOLD_PX = 20;
/** Floor for short panes, where a viewport third would be only a few lines. */
export const MIN_AWAY_DISTANCE_PX = 120;

export function distanceFromBottom({ scrollTop, scrollHeight, clientHeight }: ScrollMetrics): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function awayThreshold(clientHeight: number): number {
  return Math.max(MIN_AWAY_DISTANCE_PX, clientHeight / 3);
}

/**
 * Entering "away" needs a viewport third of distance, but only the bottom
 * leaves it. The hysteresis matters: compacting the chrome changes the
 * transcript height, which would otherwise flip the state back and forth.
 */
export function resolveNavScrollState(metrics: ScrollMetrics, wasAway: boolean): NavScrollState {
  const scrollable = metrics.scrollHeight > metrics.clientHeight + SCROLLABLE_BUFFER_PX;
  const distance = distanceFromBottom(metrics);
  const atBottom = distance <= AT_BOTTOM_THRESHOLD_PX;
  const away = scrollable && (wasAway ? !atBottom : distance > awayThreshold(metrics.clientHeight));
  return { scrollable, atBottom, away };
}
