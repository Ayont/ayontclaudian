/**
 * Claudian - Print-mode session recovery
 *
 * Print-mode provider runtimes (Vibe, Grok, Antigravity) resume their native CLI
 * session by id. When that OWN session has gone stale (e.g. the CLI's session
 * store was pruned, or you switched away and back after a long pause), the CLI
 * exits non-zero with a "session not found" style stderr. Without recovery the
 * runtime surfaces a raw `exited with code N` error card.
 *
 * This module provides a precise, pure detector so a runtime can instead clear
 * the dead session and retry the turn fresh — no scary error, context preserved.
 */

import { getLocale } from '../../i18n/i18n';

/**
 * Locale-aware notice shown when a dead session is auto-cleared and the turn is
 * retried fresh. Bilingual inline (de/en) to match errorClassification's
 * self-contained string convention without touching every locale file.
 */
export function staleSessionRetryNotice(providerLabel: string): string {
  return getLocale() === 'de'
    ? `${providerLabel}-Sitzung war abgelaufen — neu gestartet.`
    : `${providerLabel} session had expired — restarted.`;
}

const STALE_SESSION_MARKERS = [
  'session not found',
  'session expired',
  'invalid session',
  'session invalid',
  'no such session',
  'no conversation found',
  'conversation not found',
  'no rollout',
  'session does not exist',
  'session id not found',
  'unknown session',
] as const;

/**
 * Heuristic: does this CLI output read like a dead/expired session? Precise on
 * purpose — requires explicit session/conversation/rollout wording so a generic
 * crash is never misread as a stale session (which would double-run the turn).
 */
export function looksLikeStaleSession(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  if (!t) return false;
  if (STALE_SESSION_MARKERS.some((m) => t.includes(m))) return true;
  // Compound: the word "session" near a "missing/expired" signal.
  if (
    t.includes('session') &&
    (t.includes('not found') || t.includes('does not exist') || t.includes('expired'))
  ) {
    return true;
  }
  return false;
}

export interface StaleResumeFailureParams {
  /** Was a session id actually resumed this turn? */
  hadSession: boolean;
  /** Process exit code (null = spawn/IO error, not a clean exit). */
  exitCode: number | null;
  /** Captured stderr. */
  stderr: string;
  /** Did the turn already stream assistant output? If so, never retry (avoid dupes). */
  producedOutput: boolean;
}

/**
 * True when a finished print-mode turn failed specifically because the resumed
 * OWN session no longer exists, so the runtime should clear it and retry fresh.
 */
export function isStaleResumeFailure(params: StaleResumeFailureParams): boolean {
  if (!params.hadSession) return false;
  if (params.producedOutput) return false;
  if (params.exitCode === 0 || params.exitCode === null) return false;
  return looksLikeStaleSession(params.stderr);
}
