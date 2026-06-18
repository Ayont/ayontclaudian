/**
 * Claudian - Error history
 *
 * A small in-memory ring buffer of the most recent provider errors, surfaced by
 * the "Copy diagnostics" command. Lives as a module singleton (no DI plumbing)
 * because it is a pure, cross-cutting diagnostic sink. Not persisted — it resets
 * on reload, which is fine for "what just went wrong" debugging.
 */

export interface ErrorRecord {
  /** Epoch milliseconds. */
  timestamp: number;
  providerId: string;
  message: string;
}

/** Maximum number of retained error records. */
export const ERROR_HISTORY_LIMIT = 20;

/** Single-line cap so a giant stack trace never dominates the buffer. */
const MESSAGE_CAP = 300;

const records: ErrorRecord[] = [];

function normalizeMessage(message: string): string {
  const oneLine = (message ?? '').replace(/\s+/g, ' ').trim();
  return oneLine.length > MESSAGE_CAP ? `${oneLine.slice(0, MESSAGE_CAP)}…` : oneLine;
}

/** Records a provider error, keeping only the most recent {@link ERROR_HISTORY_LIMIT}. */
export function recordProviderError(providerId: string, message: string, timestamp = Date.now()): void {
  const normalized = normalizeMessage(message);
  if (!normalized) return;
  records.push({ timestamp, providerId, message: normalized });
  if (records.length > ERROR_HISTORY_LIMIT) {
    records.splice(0, records.length - ERROR_HISTORY_LIMIT);
  }
}

/** Returns a copy of the error history, newest last. */
export function getErrorHistory(): ErrorRecord[] {
  return [...records];
}

/** Clears the error history (used by tests and a future "clear" affordance). */
export function clearErrorHistory(): void {
  records.length = 0;
}
