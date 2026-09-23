/** One window as a provider reports it itself — the same shape Codex writes. */
export interface NativeRateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAtEpochSec: number;
}

export interface NativeRateLimitSnapshot {
  windows: NativeRateLimitWindow[];
}

/**
 * A live report from a running runtime. Claude's `rate_limit_event` names one
 * limit at a time, so a report carries at most one window; `window` is null when
 * the provider sent a status without utilization, which must not become a
 * made-up percentage.
 */
export interface ProviderRateLimitReport {
  window: NativeRateLimitWindow | null;
  /** The provider refuses work right now. */
  rejected: boolean;
  resetsAtEpochSec: number | null;
}

/**
 * In-memory, per provider: live reports only exist while a runtime streams, and
 * a stale utilization from a previous session would be worse than the estimate.
 */
export class NativeRateLimitStore {
  private readonly snapshots = new Map<string, NativeRateLimitSnapshot>();

  record(providerId: string, report: ProviderRateLimitReport): void {
    const window = report.window;
    if (!window) return;
    const others = (this.snapshots.get(providerId)?.windows ?? [])
      .filter((existing) => existing.windowMinutes !== window.windowMinutes);
    this.snapshots.set(providerId, {
      windows: [...others, window].sort((a, b) => a.windowMinutes - b.windowMinutes),
    });
  }

  get(providerId: string): NativeRateLimitSnapshot | null {
    return this.snapshots.get(providerId) ?? null;
  }

  snapshot(): Record<string, NativeRateLimitSnapshot> {
    return Object.fromEntries(this.snapshots);
  }
}
