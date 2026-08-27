import type { UsageInfo } from '../types';

/**
 * One measured turn: tokens consumed at `ts` by provider+model.
 *
 * `tokens` is the window/budget figure (see {@link TokenBudgetTracker.trackUsage});
 * the itemized fields below are what cost estimation needs and are only present
 * when the provider actually reported them — an absent field means "not reported",
 * never "zero".
 */
export interface UsageEvent {
  ts: number;
  providerId: string;
  model: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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
      ? {
        ...initial,
        // Rehydrating from disk starts a NEW session, so the session counter must
        // not carry over. It used to, which turned a "Session token budget" of e.g.
        // 1,000,000 into a permanent lockout: once the persisted total crossed the
        // cap, every send was refused forever, across restarts, with no way back
        // except the explicit reset command.
        //
        // `dailyTotal` (day-rollover logic below), `breakdown`, and `events` are
        // deliberately preserved — `events` in particular drives the rolling
        // rate-limit window, which is the entire reason usage is persisted at all.
        sessionTotal: 0,
      }
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
    // Snapshots are cumulative display state, not additional consumption.
    // Keep this guard at the persistence boundary as well as in the chat
    // controller so raw/auxiliary collectors cannot reintroduce double counts.
    if (usage.reportType === 'snapshot' || usage.isRestatedSnapshot === true) {
      return;
    }
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
    events.push({
      ts: Date.now(),
      providerId,
      model: usage.model || 'default',
      tokens: delta,
      ...(usage.inputTokens > 0 ? { inputTokens: usage.inputTokens } : {}),
      ...(usage.outputTokens ? { outputTokens: usage.outputTokens } : {}),
      ...(usage.cacheReadInputTokens ? { cacheReadTokens: usage.cacheReadInputTokens } : {}),
      ...(usage.cacheCreationInputTokens ? { cacheWriteTokens: usage.cacheCreationInputTokens } : {}),
    });
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

  /** Raw events, optionally narrowed to one provider and/or a time range. */
  getEvents(filter: { providerId?: string; since?: number } = {}): UsageEvent[] {
    return (this.state.events ?? []).filter((event) => {
      if (filter.providerId && event.providerId !== filter.providerId) return false;
      if (filter.since !== undefined && event.ts < filter.since) return false;
      return true;
    });
  }

  /** Every provider that has recorded at least one event. */
  getSeenProviderIds(): string[] {
    return [...new Set((this.state.events ?? []).map((event) => event.providerId))];
  }

  /**
   * Tokens per local day, oldest first — the series behind the usage sparklines.
   * Days with no activity are present as zeros so the chart keeps a stable width.
   */
  getDailySeries(providerId: string | null, days: number, now = Date.now()): number[] {
    const span = Math.max(1, Math.round(days));
    const series = new Array<number>(span).fill(0);
    const reference = new Date(now);
    const startOfToday = new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate(),
    ).getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    for (const event of this.state.events ?? []) {
      if (providerId && event.providerId !== providerId) continue;
      // Bucket by LOCAL calendar day, not by elapsed milliseconds: an event from
      // this morning is 0 days ago even though `now - ts` is a fraction of a day,
      // and rounding absorbs DST shifts.
      const eventDate = new Date(event.ts);
      const eventDayStart = new Date(
        eventDate.getFullYear(),
        eventDate.getMonth(),
        eventDate.getDate(),
      ).getTime();
      const dayOffset = Math.round((startOfToday - eventDayStart) / dayMs);
      const index = span - 1 - dayOffset;
      if (index >= 0 && index < span) {
        series[index] += event.tokens;
      }
    }
    return series;
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
