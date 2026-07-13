import type { UsageInfo } from '../types';

export interface TokenBudgetState {
  dailyTotal: number;
  sessionTotal: number;
  lastResetDay: string; // ISO date YYYY-MM-DD
  breakdown: Record<string, { tokens: number; runs: number }>;
}

export interface TokenBudgetCheck {
  ok: boolean;
  reason?: string;
}

export interface TokenBudgetSettings {
  tokenBudgetEnabled?: boolean;
  dailyTokenBudget?: number;
  sessionTokenBudget?: number;
}

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TokenBudgetTracker {
  private state: TokenBudgetState;

  constructor(initial?: TokenBudgetState) {
    this.state = initial && initial.lastResetDay
      ? { ...initial }
      : {
        dailyTotal: 0,
        sessionTotal: 0,
        lastResetDay: getTodayKey(),
        breakdown: {},
      };
    this.state.breakdown = { ...(this.state.breakdown ?? {}) };
    this.ensureDayRollover();
  }

  private ensureDayRollover(): void {
    const today = getTodayKey();
    if (this.state.lastResetDay !== today) {
      this.state.dailyTotal = 0;
      this.state.lastResetDay = today;
    }
  }

  /**
   * Records additional token usage. Uses `contextTokens` when available and
   * authoritative; otherwise falls back to `inputTokens` so every provider
   * contributes a number even when only input tokens are reported.
   */
  trackUsage(usage: UsageInfo, providerId = 'unknown'): void {
    this.ensureDayRollover();
    const delta = usage.contextTokens > 0
      ? usage.contextTokens
      : usage.inputTokens;
    if (delta <= 0) return;
    this.state.dailyTotal += delta;
    this.state.sessionTotal += delta;
    const key = `${providerId}:${usage.model || 'default'}`;
    const current = this.state.breakdown[key] ?? { tokens: 0, runs: 0 };
    this.state.breakdown[key] = { tokens: current.tokens + delta, runs: current.runs + 1 };
  }

  checkBudget(settings: TokenBudgetSettings): TokenBudgetCheck {
    if (settings.tokenBudgetEnabled === false) {
      return { ok: true };
    }

    this.ensureDayRollover();

    const daily = settings.dailyTokenBudget;
    if (daily !== undefined && daily > 0 && this.state.dailyTotal >= daily) {
      return {
        ok: false,
        reason: `Daily token budget reached (${this.state.dailyTotal.toLocaleString()} / ${daily.toLocaleString()}).`,
      };
    }

    const session = settings.sessionTokenBudget;
    if (session !== undefined && session > 0 && this.state.sessionTotal >= session) {
      return {
        ok: false,
        reason: `Session token budget reached (${this.state.sessionTotal.toLocaleString()} / ${session.toLocaleString()}).`,
      };
    }

    return { ok: true };
  }

  getState(): TokenBudgetState {
    this.ensureDayRollover();
    return { ...this.state };
  }

  resetSession(): void {
    this.state.sessionTotal = 0;
    this.state.breakdown = {};
  }

  resetDaily(): void {
    this.state.dailyTotal = 0;
    this.state.lastResetDay = getTodayKey();
    this.state.breakdown = {};
  }
}
