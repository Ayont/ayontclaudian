/**
 * Visual primitives for the usage & cost center: an SVG sparkline and a
 * count-up animation for the headline figures.
 *
 * Both respect `prefers-reduced-motion` by jumping straight to the final state —
 * the information is in the number and the shape, never in the movement.
 */

const SPARK_WIDTH = 160;
const SPARK_HEIGHT = 34;
const COUNT_DURATION_MS = 780;
const SVG_NS = 'http://www.w3.org/2000/svg';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Builds the sparkline geometry: a normalized polyline plus the closing area
 * path. Pure and exported so the shape is testable without a DOM.
 */
export function buildSparklinePoints(
  series: number[],
  width = SPARK_WIDTH,
  height = SPARK_HEIGHT,
): { x: number; y: number }[] {
  if (series.length === 0) return [];
  if (series.length === 1) return [{ x: 0, y: height / 2 }, { x: width, y: height / 2 }];

  const max = Math.max(...series);
  const step = width / (series.length - 1);
  // A flat-zero series would divide by zero; render it as a baseline instead.
  const scale = max > 0 ? (height - 2) / max : 0;

  return series.map((value, index) => ({
    x: Number((index * step).toFixed(2)),
    y: Number((height - 1 - value * scale).toFixed(2)),
  }));
}

export function toPolylinePath(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`).join(' ');
}

export function toAreaPath(points: { x: number; y: number }[], height = SPARK_HEIGHT): string {
  if (points.length === 0) return '';
  const last = points[points.length - 1];
  return `${toPolylinePath(points)} L${last.x} ${height} L${points[0].x} ${height} Z`;
}

/** Renders the sparkline for a daily token series into `parent`. */
export function renderSparkline(parent: HTMLElement, series: number[]): void {
  const points = buildSparklinePoints(series);
  if (points.length === 0) return;

  // Own the document from the target element so the SVG is created in the right
  // window when Obsidian renders this panel in a popout.
  const doc = parent.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('claudian-usage-spark-svg');

  const area = doc.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', toAreaPath(points));
  area.classList.add('claudian-usage-spark-area');
  svg.appendChild(area);

  const line = doc.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', toPolylinePath(points));
  line.classList.add('claudian-usage-spark-line');
  svg.appendChild(line);

  const peak = points.reduce((best, point) => (point.y < best.y ? point : best), points[0]);
  const dot = doc.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', String(peak.x));
  dot.setAttribute('cy', String(peak.y));
  dot.setAttribute('r', '2');
  dot.classList.add('claudian-usage-spark-dot');
  svg.appendChild(dot);

  parent.appendChild(svg);
}

/** Eased 0→1 progress: fast start, soft landing. */
function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * Counts an element's number up to `target`, keeping the caller's final label as
 * the authoritative last frame (so "1.2M" is never rendered as "1200000").
 */
export function animateCount(el: HTMLElement, target: number, finalText: string): void {
  if (prefersReducedMotion() || target <= 0) {
    el.setText(finalText);
    return;
  }

  const decimals = finalText.includes(',') || finalText.includes('.') ? 1 : 0;
  const start = performance.now();

  const tick = (timestamp: number): void => {
    if (!el.isConnected) return;
    const progress = Math.min(1, (timestamp - start) / COUNT_DURATION_MS);
    if (progress >= 1) {
      el.setText(finalText);
      return;
    }
    const value = target * easeOutCubic(progress);
    el.setText(value.toFixed(decimals));
    window.requestAnimationFrame(tick);
  };

  el.setText('0');
  window.requestAnimationFrame(tick);
}
