import type { TabId } from './types';

export interface TabStripGeometry {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface TabBadgeGeometry {
  id: TabId;
  /** Offset from the start of the scrolled content. */
  left: number;
  width: number;
}

export interface TabStripOverflow {
  /** Tabs less than half on screen: the "+N" chip counts these. */
  hiddenIds: TabId[];
  canScrollStart: boolean;
  canScrollEnd: boolean;
}

/** Sub-pixel layout rounding must not flash a fade on a strip that fits. */
const EDGE_TOLERANCE = 1;

export function measureTabStripOverflow(
  strip: TabStripGeometry,
  badges: readonly TabBadgeGeometry[],
): TabStripOverflow {
  const viewStart = strip.scrollLeft;
  const viewEnd = strip.scrollLeft + strip.clientWidth;
  const hiddenIds: TabId[] = [];
  for (const badge of badges) {
    const visible = Math.min(badge.left + badge.width, viewEnd) - Math.max(badge.left, viewStart);
    if (visible < badge.width / 2) hiddenIds.push(badge.id);
  }
  return {
    hiddenIds,
    canScrollStart: strip.scrollLeft > EDGE_TOLERANCE,
    canScrollEnd: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - EDGE_TOLERANCE,
  };
}

/**
 * The scroll offset that brings a badge fully into view, `margin` clear of the
 * edge fades, or null when it is already visible.
 */
export function scrollLeftToReveal(
  strip: TabStripGeometry,
  badge: TabBadgeGeometry,
  margin: number,
): number | null {
  const viewStart = strip.scrollLeft;
  const viewEnd = strip.scrollLeft + strip.clientWidth;
  let target: number | null = null;
  if (badge.left - margin < viewStart) {
    target = badge.left - margin;
  } else if (badge.left + badge.width + margin > viewEnd) {
    target = badge.left + badge.width + margin - strip.clientWidth;
  }
  if (target === null) return null;
  const maxScroll = Math.max(0, strip.scrollWidth - strip.clientWidth);
  const clamped = Math.min(Math.max(target, 0), maxScroll);
  return Math.abs(clamped - strip.scrollLeft) < EDGE_TOLERANCE ? null : clamped;
}
