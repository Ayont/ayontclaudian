import type { CodexRateLimitSnapshot } from '../../providers/codex/runtime/rateLimits';

/** One compact status-bar chip: what is limited, how full, when it frees. */
export interface RateLimitChip {
  providerId: string;
  /** Human window name — '5h', '7T', or a generic fallback. */
  label: string;
  /** Percent used, when the provider reports one natively. */
  percent?: number | null;
  /** Tokens consumed in the window, for tracker-based providers. */
  tokensUsed?: number | null;
  /** Formatted remaining time until the window resets. */
  resetIn: string;
}

export interface CodexRateLimitSnapshotInput {
  planType?: string;
  windows: Array<{ usedPercent: number; windowMinutes: number; resetsAtEpochSec: number }>;
}

export interface ProviderWindowInput {
  providerId: string;
  tokens: number;
  resetAt: number | null;
}

/** Names the subscription windows users know by heart; anything else stays
 *  generic instead of inventing a marketing name. */
export function windowLabel(windowMinutes: number): string {
  if (windowMinutes === 300) return '5h';
  if (windowMinutes === 10080) return '7T';
  const hours = Math.round(windowMinutes / 60);
  if (hours >= 1) return hours + 'h-Fenster';
  return windowMinutes + 'min-Fenster';
}

/** Compact German countdown; sub-minute reads as overdue. */
export function formatResetIn(resetsAtMs: number, now: number): string {
  const remainingMs = resetsAtMs - now;
  if (remainingMs <= 0) {
    return 'Reset fällig';
  }
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return hours + 'h ' + minutes + 'm';
  if (hours > 0) return hours + 'h';
  return minutes + 'm';
}

const DEFAULT_TRACKER_WINDOW_MINUTES = 300;

export interface RateLimitChipInputs {
  codex: CodexRateLimitSnapshotInput | null;
  trackerWindows: ProviderWindowInput[];
  now: number;
}

/** Builds status-bar chips: native provider percentages win (Codex), tracker
 *  windows follow with honest token counts instead of invented percentages.
 *  A chip without any usable data is dropped entirely. */
export function buildRateLimitChips(inputs: RateLimitChipInputs): RateLimitChip[] {
  const chips: RateLimitChip[] = [];
  const snapshot = inputs.codex as CodexRateLimitSnapshot | null;
  if (snapshot) {
    for (const window of snapshot.windows) {
      chips.push({
        providerId: 'codex',
        label: windowLabel(window.windowMinutes),
        percent: Math.round(window.usedPercent),
        resetIn: formatResetIn(window.resetsAtEpochSec * 1000, inputs.now),
      });
    }
  }
  for (const window of inputs.trackerWindows) {
    if (window.tokens <= 0 || window.resetAt === null) {
      continue;
    }
    chips.push({
      providerId: window.providerId,
      label: windowLabel(DEFAULT_TRACKER_WINDOW_MINUTES),
      percent: null,
      tokensUsed: window.tokens,
      resetIn: formatResetIn(window.resetAt, inputs.now),
    });
  }
  return chips;
}