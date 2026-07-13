export interface AnimateNumberOptions {
  duration?: number;
  from?: number;
  formatter?: (value: number) => string;
  reducedMotion?: boolean;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

const DEFAULT_DURATION_MS = 620;

export function easeOutQuart(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - ((1 - clamped) ** 4);
}

/**
 * Counts a metric toward its next real value. It only animates text content,
 * uses requestAnimationFrame, and immediately settles under reduced motion.
 */
export function animateNumber(
  element: HTMLElement,
  target: number,
  options: AnimateNumberOptions = {},
): () => void {
  const ownerWindow = element.ownerDocument.defaultView ?? window;
  const formatter = options.formatter ?? ((value: number) => value.toLocaleString());
  const from = Number.isFinite(options.from) ? options.from! : 0;
  const duration = Math.max(0, options.duration ?? DEFAULT_DURATION_MS);
  const reducedMotion = options.reducedMotion
    ?? ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ?? false;
  const requestFrame = options.requestFrame ?? ownerWindow.requestAnimationFrame.bind(ownerWindow);
  const cancelFrame = options.cancelFrame ?? ownerWindow.cancelAnimationFrame.bind(ownerWindow);
  const safeTarget = Number.isFinite(target) ? target : 0;

  if (reducedMotion || duration === 0 || from === safeTarget) {
    element.textContent = formatter(Math.round(safeTarget));
    return () => {};
  }

  element.classList.add('is-counting');
  element.textContent = formatter(Math.round(from));
  let startedAt: number | null = null;
  let frameHandle = 0;
  let cancelled = false;

  const tick = (timestamp: number) => {
    if (cancelled) return;
    startedAt ??= timestamp;
    const progress = Math.min(1, (timestamp - startedAt) / duration);
    const value = from + ((safeTarget - from) * easeOutQuart(progress));
    element.textContent = formatter(Math.round(value));

    if (progress < 1) {
      frameHandle = requestFrame(tick);
    } else {
      element.textContent = formatter(Math.round(safeTarget));
      element.classList.remove('is-counting');
    }
  };

  frameHandle = requestFrame(tick);
  return () => {
    cancelled = true;
    cancelFrame(frameHandle);
    element.classList.remove('is-counting');
  };
}
