import type { UsageInfo } from '../types';

/** One measured turn: tokens consumed at `ts` by provider+model. */
export interface UsageEvent {
  ts: number;
  providerId: string;
  model: string;
  tokens: number;
}

export interface TokenBudgetState {
  dailyTotal: number;
  sessionTotal: number;
  lastResetDay: string; // ISO date YYYY-MM-DD
  breakdown: Record<string, { tokens: number; runs: number }>;
  /** Timestamped per-turn measurements — the basis for rate-limit windows. */
  events?: UsageEvent[];
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

/** Aggregated rate-limit window for one provider. */
export interface ProviderWindow {
  providerId: string;
  /** Tokens consumed inside the current window. */
  tokens: number;
  /** Event count inside the current window. */
  runs: number;
  /** Tokens since local midnight. */
  todayTokens: number;
  /** Tokens over the last 7 days (incl. today). */
  weekTokens: number;
  /** When the window frees up: oldest in-window event + windowHours. Null when the window is empty. */
  resetAt: number | null;
}

/** Default subscription window: Claude Code's 5 hours — the most common shape. */
export const DEFAULT_USAGE_WINDOW_HOURS = 5;
/** Events are only useful for window/week math — older ones get pruned. */
const EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 3000;

function getTodayKey(): string {
  // LOCAL midnight, not UTC — a "daily" number that resets at 02:00 (UTC+2)
  // feels broken to the user.
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Local-midnight timestamp for "tokens since today". */
function getStartOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
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

    const events = this.state.events ?? (this.state.events = []);
    events.push({ ts: Date.now(), providerId, model: usage.model || 'default', tokens: delta });
    this.pruneEvents();
  }

  private pruneEvents(): void {
    const events = this.state.events;
    if (!events) return;
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    let firstValid = events.findIndex((event) => event.ts >= cutoff);
    if (firstValid === -1) firstValid = events.length;
    if (firstValid > 0) events.splice(0, firstValid);
    if (events.length > MAX_EVENTS) {
      events.splice(0, events.length - MAX_EVENTS);
    }
  }

  /**
   * Aggregates one provider's rate-limit window.
   *
   * Window semantics follow Claude Code's subscription: the window STARTS at
   * the first in-window event and RESETS `windowHours` later at once (not
   * per-event sliding) — so `resetAt` = oldest in-window event + windowHours.
   * For other providers this is an honest approximation, and the window
   * length is user-configurable per provider.
   */
  getProviderWindow(providerId: string, windowHours = DEFAULT_USAGE_WINDOW_HOURS, now = Date.now()): ProviderWindow {
    const windowMs = windowHours * 60 * 60 * 1000;
    const windowStart = now - windowMs;
    const startOfToday = getStartOfToday();
    const weekStart = now - EVENT_RETENTION_MS;

    let tokens = 0;
    let runs = 0;
    let todayTokens = 0;
    let weekTokens = 0;
    let oldestInWindow: number | null = null;

    for (const event of this.state.events ?? []) {
      if (event.providerId !== providerId) continue;
      if (event.ts >= weekStart) weekTokens += event.tokens;
      if (event.ts >= startOfToday) todayTokens += event.tokens;
      if (event.ts >= windowStart) {
        tokens += event.tokens;
        runs += 1;
        if (oldestInWindow === null || event.ts < oldestInWindow) oldestInWindow = event.ts;
      }
    }

    return {
      providerId,
      tokens,
      runs,
      todayTokens,
      weekTokens,
      resetAt: oldestInWindow !== null ? oldestInWindow + windowMs : null,
    };
  }

  /** All providers with any recorded event, sorted by window tokens desc. */
  getWindowedProviders(windowHoursByProvider: Record<string, number> = {}, now = Date.now()): ProviderWindow[] {
    const providerIds = new Set((this.state.events ?? []).map((event) => event.providerId));
    return [...providerIds]
      .map((id) => this.getProviderWindow(id, windowHoursByProvider[id] ?? DEFAULT_USAGE_WINDOW_HOURS, now))
      .sort((a, b) => b.tokens - a.tokens);
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
    this.state.events = [];
  }

  resetDaily(): void {
    this.state.dailyTotal = 0;
    this.state.lastResetDay = getTodayKey();
    this.state.breakdown = {};
    this.state.events = [];
  }
}
