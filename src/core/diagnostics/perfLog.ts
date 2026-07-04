/**
 * Lightweight, opt-in performance instrumentation.
 *
 * Enabled only when the user sets `localStorage.setItem('claudian:perf', '1')`
 * in the devtools console — so production installs stay silent. Power users can
 * then see how long the always-on memory recall / vault RAG / send prep takes,
 * which is the direct proof that the CachedMemoryStore (5.7.0) is working.
 *
 * The last measurement per stable key is also retained in memory (negligible
 * cost) so the `/status` command can surface "last memory recall: 4.2ms" without
 * requiring the console flag.
 *
 * Usage:
 *   const t = perfMark();
 *   ... work ...
 *   perfSince(t, 'memory-recall', '3 matched, 14 notes');
 */
const PERF_FLAG = 'claudian:perf';

interface PerfRecord {
  ms: number;
  at: number;
  detail?: string;
}

/** Last measurement per stable key (e.g. 'memory-recall', 'vault-rag'). */
const recentPerf = new Map<string, PerfRecord>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function perfEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PERF_FLAG) === '1';
  } catch {
    return false;
  }
}

/** High-resolution timestamp (ms). */
export function perfMark(): number {
  return now();
}

/**
 * Records the elapsed time since `start` under `key`. Logs to the debug console
 * only when perf logging is enabled; always stores the last value for `/status`.
 * `detail` is extra context shown in the log line (e.g. "3 matched, 14 notes").
 */
export function perfSince(start: number, key: string, detail?: string): void {
  const ms = now() - start;
  recentPerf.set(key, { ms, at: Date.now(), detail });
  if (perfEnabled()) {
    // eslint-disable-next-line no-console
    console.debug(`[claudian:perf] ${key}${detail ? ` (${detail})` : ''}: ${ms.toFixed(1)}ms`);
  }
}

/** The last recorded measurement for `key` (or undefined if none yet). */
export function getLastPerf(key: string): PerfRecord | undefined {
  return recentPerf.get(key);
}

/** Measures an async operation and records it under `key` (always stored; logged only when enabled). */
export async function perfAsync<T>(key: string, fn: () => Promise<T>, detail?: string): Promise<T> {
  const start = perfMark();
  try {
    return await fn();
  } finally {
    perfSince(start, key, detail);
  }
}

