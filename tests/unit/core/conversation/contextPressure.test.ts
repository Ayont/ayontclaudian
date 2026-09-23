import {
  CONTEXT_PRESSURE_CRITICAL_PERCENT,
  CONTEXT_PRESSURE_DISMISS_STEP,
  CONTEXT_PRESSURE_HIGH_PERCENT,
  dismissContextPressure,
  isContextPressureVisible,
  resolveContextPressureLevel,
} from '@/core/conversation/contextPressure';

describe('resolveContextPressureLevel', () => {
  it('uses the named thresholds', () => {
    expect(CONTEXT_PRESSURE_HIGH_PERCENT).toBe(80);
    expect(CONTEXT_PRESSURE_CRITICAL_PERCENT).toBe(92);
    expect(CONTEXT_PRESSURE_DISMISS_STEP).toBe(5);
  });

  it.each([
    [0, 'normal'],
    [79, 'normal'],
    [79.9, 'normal'],
    [80, 'high'],
    [91, 'high'],
    [92, 'critical'],
    [100, 'critical'],
    [130, 'critical'],
  ] as const)('%d%% is %s', (percentage, level) => {
    expect(resolveContextPressureLevel(percentage)).toBe(level);
  });

  it('treats a non-finite percentage as normal', () => {
    expect(resolveContextPressureLevel(Number.NaN)).toBe('normal');
  });
});

describe('isContextPressureVisible', () => {
  it('never shows below the high threshold', () => {
    expect(isContextPressureVisible(60, null)).toBe(false);
  });

  it('shows at high and critical without a dismissal', () => {
    expect(isContextPressureVisible(80, null)).toBe(true);
    expect(isContextPressureVisible(95, null)).toBe(true);
  });

  it('stays hidden after a dismissal until usage rises by the dismiss step', () => {
    const dismissal = dismissContextPressure(82);
    expect(isContextPressureVisible(82, dismissal)).toBe(false);
    expect(isContextPressureVisible(86, dismissal)).toBe(false);
    expect(isContextPressureVisible(87, dismissal)).toBe(true);
  });

  it('reappears as soon as usage reaches the next level', () => {
    const dismissal = dismissContextPressure(90);
    expect(isContextPressureVisible(91, dismissal)).toBe(false);
    expect(isContextPressureVisible(92, dismissal)).toBe(true);
  });

  it('keeps a critical dismissal until another step is climbed', () => {
    const dismissal = dismissContextPressure(93);
    expect(dismissal).toEqual({ level: 'critical', percentage: 93 });
    expect(isContextPressureVisible(97, dismissal)).toBe(false);
    expect(isContextPressureVisible(98, dismissal)).toBe(true);
  });

  it('stays hidden below the high threshold even with a dismissal on record', () => {
    expect(isContextPressureVisible(40, dismissContextPressure(85))).toBe(false);
  });
});
