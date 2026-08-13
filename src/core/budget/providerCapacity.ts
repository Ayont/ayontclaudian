/**
 * Claudian - Provider capacity scoring
 *
 * "Which provider still has room?" — the question the master prompter asks before
 * every dispatch. Capacity combines three signals:
 *
 *  1. the rolling rate-limit window (tokens burned since the window opened)
 *  2. an optional user-configured token cap for that window
 *  3. a live rate-limit cooldown recorded when a provider actually refused work
 *
 * Without a cap there is no usable ceiling, so headroom stays at 1 and the
 * provider is treated as free — an honest "unknown, not exhausted" rather than a
 * fabricated limit. Pure module: no registry, no storage, no clock of its own.
 */

import type { ProviderWindow } from './tokenBudget';

export interface ProviderCapacity {
  providerId: string;
  /** Provider is registered, enabled, and multi-agent capable. */
  enabled: boolean;
  /** Free share of the configured cap, 0..1. Always 1 when no cap is set. */
  headroom: number;
  /** Tokens consumed in the current rate-limit window. */
  windowTokens: number;
  /** Configured cap for the window; 0 means "no cap configured". */
  cap: number;
  /** When the current window frees up, if known. */
  resetAt: number | null;
  /** Cooldown end after an observed rate limit, if any. */
  cooldownUntil: number | null;
  /** True when the provider can take work right now. */
  available: boolean;
  /** Why the provider is (un)available — surfaced in the mission UI. */
  reason: string;
  /** Ranking score; higher is a better dispatch target. */
  score: number;
}

export interface ProviderCapacityInput {
  providerId: string;
  enabled: boolean;
  window: ProviderWindow | null;
  /** 0 = no cap configured. */
  cap: number;
  /** Timestamp until which the provider is cooling down after a rate limit. */
  cooldownUntil?: number | null;
}

/** Below this share of free capacity a provider is considered exhausted. */
export const CAPACITY_EXHAUSTED_THRESHOLD = 0.02;
/** Below this share the provider still works but is deprioritized. */
export const CAPACITY_LOW_THRESHOLD = 0.15;
/** Default cooldown after an observed rate limit, when the provider names no reset. */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

export function scoreProviderCapacity(input: ProviderCapacityInput, now: number): ProviderCapacity {
  const windowTokens = input.window?.tokens ?? 0;
  const cap = input.cap > 0 ? input.cap : 0;
  const headroom = cap > 0 ? Math.min(1, Math.max(0, 1 - windowTokens / cap)) : 1;
  const cooldownUntil = input.cooldownUntil && input.cooldownUntil > now ? input.cooldownUntil : null;

  const base: Omit<ProviderCapacity, 'available' | 'reason' | 'score'> = {
    providerId: input.providerId,
    enabled: input.enabled,
    headroom,
    windowTokens,
    cap,
    resetAt: input.window?.resetAt ?? null,
    cooldownUntil,
  };

  if (!input.enabled) {
    return { ...base, available: false, reason: 'deaktiviert', score: -1 };
  }
  if (cooldownUntil) {
    return { ...base, available: false, reason: 'Rate-Limit', score: -1 };
  }
  if (cap > 0 && headroom <= CAPACITY_EXHAUSTED_THRESHOLD) {
    return { ...base, available: false, reason: 'Limit erreicht', score: -1 };
  }

  // Prefer untouched providers over merely under-cap ones: with no cap configured
  // the least-used provider should still win, so idle time feeds the score.
  const usagePenalty = cap > 0 ? 0 : Math.min(0.5, windowTokens / 1_000_000);
  const score = headroom - usagePenalty;
  const reason = cap > 0 && headroom <= CAPACITY_LOW_THRESHOLD ? 'wenig Kontingent' : 'frei';

  return { ...base, available: true, reason, score };
}

/** Capacities sorted best-first: available providers by score, then the rest. */
export function rankProviderCapacities(
  inputs: ProviderCapacityInput[],
  now: number,
): ProviderCapacity[] {
  return inputs
    .map((input) => scoreProviderCapacity(input, now))
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.windowTokens - b.windowTokens;
    });
}

/**
 * Spreads N work items across the available providers, best capacity first and
 * round-robin from there so a single provider does not absorb the whole mission.
 * Falls back to the full ranking when nothing is available, because refusing to
 * dispatch at all is worse than trying a provider that may still answer.
 */
export function distributeAcrossProviders(
  capacities: ProviderCapacity[],
  count: number,
): string[] {
  if (count <= 0) return [];
  const pool = capacities.filter((capacity) => capacity.available);
  const targets = pool.length > 0 ? pool : capacities;
  if (targets.length === 0) return [];

  return Array.from({ length: count }, (_, index) => targets[index % targets.length].providerId);
}

/** Human-readable remaining time until a window or cooldown frees up. */
export function formatCapacityReset(timestamp: number | null, now: number): string {
  if (!timestamp || timestamp <= now) return '—';
  const minutes = Math.ceil((timestamp - now) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
