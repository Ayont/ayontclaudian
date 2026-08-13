import {
  buildSparklinePoints,
  toAreaPath,
  toPolylinePath,
} from '../../../../../src/features/settings/ui/usageCostVisuals';

describe('buildSparklinePoints', () => {
  test('spreads points evenly across the width', () => {
    const points = buildSparklinePoints([1, 2, 3], 100, 20);

    expect(points.map((point) => point.x)).toEqual([0, 50, 100]);
  });

  test('maps the maximum to the top and lower values below it', () => {
    const points = buildSparklinePoints([0, 10], 100, 20);

    expect(points[1].y).toBeLessThan(points[0].y);
    expect(points[1].y).toBeGreaterThanOrEqual(0);
  });

  test('renders an all-zero series as a flat baseline instead of dividing by zero', () => {
    const points = buildSparklinePoints([0, 0, 0], 100, 20);

    expect(points.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(new Set(points.map((point) => point.y)).size).toBe(1);
  });

  test('handles single-point and empty series', () => {
    expect(buildSparklinePoints([5], 100, 20)).toHaveLength(2);
    expect(buildSparklinePoints([])).toEqual([]);
  });
});

describe('path builders', () => {
  test('the polyline starts with a move and continues with lines', () => {
    const path = toPolylinePath(buildSparklinePoints([1, 2], 100, 20));

    expect(path.startsWith('M')).toBe(true);
    expect(path).toContain('L');
  });

  test('the area path closes back to the baseline', () => {
    const path = toAreaPath(buildSparklinePoints([1, 2], 100, 20), 20);

    expect(path.endsWith('Z')).toBe(true);
    expect(path).toContain('L100 20');
  });

  test('an empty series produces no area path', () => {
    expect(toAreaPath([])).toBe('');
  });
});
