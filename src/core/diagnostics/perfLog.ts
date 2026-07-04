/**
 * Lightweight, opt-in performance instrumentation.
 *
 * Enabled only when the user sets `localStorage.setItem('claudian:perf', '1')`
 * in the devtools console — so production installs stay silent. Power users can
 * then see how long the always-on memory recall / vault RAG / send prep takes,
 * which is the direct proof that the CachedMemoryStore (5.7.0) is working.
 *
 * Usage:
 *   const t = perfMark();
 *   ... work ...
 *   perfSince(t, 'memory recall');
 */
const PERF_FLAG = 'claudian:perf';

function perfEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PERF_FLAG) === '1';
  } catch {
    return false;
  }
}

/** High-resolution timestamp (ms). */
export function perfMark(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Logs `label: <ms>ms` to the debug console when perf logging is enabled. */
export function perfSince(start: number, label: string): void {
  if (!perfEnabled()) return;
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - start;
  // eslint-disable-next-line no-console
  console.debug(`[claudian:perf] ${label}: ${ms.toFixed(1)}ms`);
}

/** Measures an async operation and logs it under `label` when enabled. */
export async function perfAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!perfEnabled()) {
    return fn();
  }
  const start = perfMark();
  try {
    return await fn();
  } finally {
    perfSince(start, label);
  }
}
