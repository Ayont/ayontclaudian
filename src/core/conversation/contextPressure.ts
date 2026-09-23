/**
 * Context pressure: how close a conversation is to its model's context window,
 * and whether the warning for it should be on screen. Pure so the banner, the
 * meter and tests agree on one set of thresholds.
 */

/** From here answers start to lose early context; offer to compact. */
export const CONTEXT_PRESSURE_HIGH_PERCENT = 80;
/** From here the next long turn can overflow the window. */
export const CONTEXT_PRESSURE_CRITICAL_PERCENT = 92;
/** A dismissed warning returns once usage climbs this many points further. */
export const CONTEXT_PRESSURE_DISMISS_STEP = 5;

export type ContextPressureLevel = 'normal' | 'high' | 'critical';

export interface ContextPressureDismissal {
  level: Exclude<ContextPressureLevel, 'normal'>;
  percentage: number;
}

const LEVEL_RANK: Record<ContextPressureLevel, number> = { normal: 0, high: 1, critical: 2 };

export function resolveContextPressureLevel(percentage: number): ContextPressureLevel {
  if (!Number.isFinite(percentage)) {
    return 'normal';
  }
  if (percentage >= CONTEXT_PRESSURE_CRITICAL_PERCENT) {
    return 'critical';
  }
  if (percentage >= CONTEXT_PRESSURE_HIGH_PERCENT) {
    return 'high';
  }
  return 'normal';
}

/** Records a dismissal at the current usage; null when there is nothing to dismiss. */
export function dismissContextPressure(percentage: number): ContextPressureDismissal | null {
  const level = resolveContextPressureLevel(percentage);
  if (level === 'normal') {
    return null;
  }
  return { level, percentage };
}

export function isContextPressureVisible(
  percentage: number,
  dismissal: ContextPressureDismissal | null,
): boolean {
  const level = resolveContextPressureLevel(percentage);
  if (level === 'normal') {
    return false;
  }
  if (!dismissal) {
    return true;
  }
  if (LEVEL_RANK[level] > LEVEL_RANK[dismissal.level]) {
    return true;
  }
  return percentage >= dismissal.percentage + CONTEXT_PRESSURE_DISMISS_STEP;
}
