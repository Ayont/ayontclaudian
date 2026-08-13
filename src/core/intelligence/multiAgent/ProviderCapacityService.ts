import {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  distributeAcrossProviders,
  type ProviderCapacity,
  rankProviderCapacities,
} from '../../budget/providerCapacity';
import { DEFAULT_USAGE_WINDOW_HOURS, type TokenBudgetTracker } from '../../budget/tokenBudget';
import { ProviderRegistry } from '../../providers/ProviderRegistry';
import type { ProviderId } from '../../types/provider';
import { multiAgentAvailabilityService } from './MultiAgentAvailabilityService';

export interface ProviderCapacitySettings {
  usageWindowHours?: Record<string, number>;
  usageTokenCaps?: Record<string, number>;
}

/**
 * Live view of "which provider still has room", built from the persisted usage
 * windows plus rate limits observed during this session.
 *
 * The cooldown memory is deliberately in-memory: a provider that refused work two
 * minutes ago is very likely still refusing, but that fact should not outlive the
 * session and permanently sideline a provider after a restart.
 */
export class ProviderCapacityService {
  private readonly cooldowns = new Map<string, number>();

  constructor(
    private readonly tracker: TokenBudgetTracker,
    private readonly getSettings: () => ProviderCapacitySettings & Record<string, unknown>,
  ) {}

  /** Records an observed rate limit so the provider is skipped while cooling down. */
  markRateLimited(providerId: ProviderId, cooldownMs = DEFAULT_RATE_LIMIT_COOLDOWN_MS, now = Date.now()): void {
    this.cooldowns.set(providerId, now + Math.max(0, cooldownMs));
  }

  /** Clears a cooldown, e.g. after the provider answered successfully again. */
  clearRateLimit(providerId: ProviderId): void {
    this.cooldowns.delete(providerId);
  }

  isRateLimited(providerId: ProviderId, now = Date.now()): boolean {
    const until = this.cooldowns.get(providerId);
    return until !== undefined && until > now;
  }

  /**
   * Capacity for every multi-agent-capable provider, best first.
   * Includes unavailable providers so the UI can explain *why* one is skipped.
   */
  rank(now = Date.now()): ProviderCapacity[] {
    const settings = this.getSettings();
    const windowHours = settings.usageWindowHours ?? {};
    const caps = settings.usageTokenCaps ?? {};

    const inputs = multiAgentAvailabilityService.getEligibleProviderIds().map((providerId) => ({
      providerId,
      enabled: ProviderRegistry.isEnabled(providerId, settings),
      window: this.tracker.getProviderWindow(
        providerId,
        windowHours[providerId] ?? DEFAULT_USAGE_WINDOW_HOURS,
        now,
      ),
      cap: caps[providerId] ?? 0,
      cooldownUntil: this.cooldowns.get(providerId) ?? null,
    }));

    return rankProviderCapacities(inputs, now);
  }

  /** Providers that can take work right now, best capacity first. */
  getAvailableProviderIds(now = Date.now()): ProviderId[] {
    return this.rank(now)
      .filter((capacity) => capacity.available)
      .map((capacity) => capacity.providerId as ProviderId);
  }

  /**
   * Best provider with room, optionally excluding ones already in use.
   * Falls back to the best-ranked provider overall rather than returning nothing:
   * an over-cap provider may still answer, and a missed dispatch is worse.
   */
  pickBest(exclude: Iterable<ProviderId> = [], now = Date.now()): ProviderId | null {
    const excluded = new Set(exclude);
    const ranked = this.rank(now);
    const preferred = ranked.find((capacity) => capacity.available && !excluded.has(capacity.providerId as ProviderId))
      ?? ranked.find((capacity) => capacity.available)
      ?? ranked[0];
    return (preferred?.providerId as ProviderId | undefined) ?? null;
  }

  /** Round-robin provider assignment for `count` parallel work items. */
  distribute(count: number, now = Date.now()): ProviderId[] {
    return distributeAcrossProviders(this.rank(now), count) as ProviderId[];
  }
}
