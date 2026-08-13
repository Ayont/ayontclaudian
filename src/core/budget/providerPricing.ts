/**
 * Claudian - Provider cost model
 *
 * These CLIs are billed in two fundamentally different ways, and conflating them
 * produces numbers that look precise and are wrong:
 *
 *  - **subscription** — a flat monthly plan (Claude Max, Cline Pass, Grok, …).
 *    A turn has no marginal price; what matters is the plan price and how much
 *    value you extract from it. This is the DEFAULT, because it is how these
 *    tools are actually used from Claudian.
 *  - **metered** — per-token API pricing. Only then does a per-turn euro amount
 *    exist, and only when the user has entered the rates that apply to *their*
 *    account.
 *
 * No rate is ever invented: an unconfigured metered model reports "rate missing"
 * instead of a plausible-looking guess. Everything here is pure.
 */

import type { UsageEvent } from './tokenBudget';

export type ProviderBillingMode = 'subscription' | 'metered';

/** Price per 1,000,000 tokens, in the configured currency. */
export interface TokenRate {
  input: number;
  output: number;
  /** Cached-read price; falls back to `input` when unset. */
  cacheRead?: number;
  /** Cache-write price; falls back to `input` when unset. */
  cacheWrite?: number;
}

export interface ProviderCostConfig {
  billing: ProviderBillingMode;
  /** Plan price per month for subscription providers. */
  monthlyCost?: number;
  /** Per-model rates for metered providers, keyed by model id. `*` is the default. */
  rates?: Record<string, TokenRate>;
}

export interface CostSettings {
  providerCosts?: Record<string, ProviderCostConfig>;
  /** ISO currency code used for every amount shown. Defaults to EUR. */
  costCurrency?: string;
}

export const DEFAULT_COST_CURRENCY = 'EUR';
export const DEFAULT_BILLING_MODE: ProviderBillingMode = 'subscription';
/** Wildcard key for "every model of this provider". */
export const RATE_WILDCARD = '*';
const TOKENS_PER_RATE_UNIT = 1_000_000;

export function getProviderCostConfig(
  settings: CostSettings,
  providerId: string,
): ProviderCostConfig {
  const stored = settings.providerCosts?.[providerId];
  return {
    billing: stored?.billing === 'metered' ? 'metered' : DEFAULT_BILLING_MODE,
    monthlyCost: typeof stored?.monthlyCost === 'number' && stored.monthlyCost >= 0
      ? stored.monthlyCost
      : undefined,
    rates: stored?.rates ?? {},
  };
}

/**
 * Rate for a concrete model: exact match first, then the provider wildcard.
 * Null means "no rate configured" — callers must show that, not assume zero.
 */
export function resolveTokenRate(config: ProviderCostConfig, model: string): TokenRate | null {
  if (config.billing !== 'metered') return null;
  const rates = config.rates ?? {};
  const exact = rates[model] ?? rates[model?.trim()];
  if (exact) return exact;
  return rates[RATE_WILDCARD] ?? null;
}

export interface EventCost {
  /** Cost of this event, or null when no rate is configured. */
  amount: number | null;
  /** True when the provider never reported output tokens, so only input is priced. */
  inputOnly: boolean;
}

/**
 * Prices one usage event.
 *
 * Cached reads and cache writes are billed at their own rates when configured —
 * that is where the bulk of a long agentic session's spend actually sits, so
 * folding them into the plain input rate would understate real cost.
 */
export function estimateEventCost(event: UsageEvent, rate: TokenRate | null): EventCost {
  if (!rate) return { amount: null, inputOnly: false };

  const input = event.inputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  const cacheRead = event.cacheReadTokens ?? 0;
  const cacheWrite = event.cacheWriteTokens ?? 0;

  // Nothing itemized: the event predates the itemized fields, so the only honest
  // basis is its aggregate token count at the input rate.
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return {
      amount: (event.tokens / TOKENS_PER_RATE_UNIT) * rate.input,
      inputOnly: true,
    };
  }

  const amount =
    (input / TOKENS_PER_RATE_UNIT) * rate.input
    + (output / TOKENS_PER_RATE_UNIT) * rate.output
    + (cacheRead / TOKENS_PER_RATE_UNIT) * (rate.cacheRead ?? rate.input)
    + (cacheWrite / TOKENS_PER_RATE_UNIT) * (rate.cacheWrite ?? rate.input);

  return { amount, inputOnly: output === 0 };
}

export interface ProviderCostSummary {
  providerId: string;
  billing: ProviderBillingMode;
  /** Metered spend over the requested period; null when no rate is configured. */
  meteredCost: number | null;
  /** Flat plan price per month for subscription providers. */
  monthlyCost: number | null;
  /** Total tokens attributed to this provider in the period. */
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  runs: number;
  /** Effective price per 1M tokens — for subscriptions, what the plan really costs you. */
  effectiveRatePerMillion: number | null;
  /** Models seen in the period, most-used first. */
  models: { model: string; tokens: number }[];
  /** True when at least one event could not be priced for lack of a rate. */
  hasUnpricedEvents: boolean;
  /** True when no provider in the period reported output tokens. */
  inputOnly: boolean;
}

/**
 * Aggregates one provider's events into a cost summary.
 *
 * `effectiveRatePerMillion` is deliberately computed for subscriptions too: a
 * flat plan divided by the tokens actually consumed is the single most useful
 * number for deciding whether a plan is worth its price.
 */
export function summarizeProviderCost(params: {
  providerId: string;
  events: UsageEvent[];
  config: ProviderCostConfig;
  /** Days the flat plan price is prorated over; 30 shows the full monthly price. */
  proratedDays?: number;
}): ProviderCostSummary {
  const { providerId, events, config } = params;

  let tokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let meteredCost: number | null = null;
  let hasUnpricedEvents = false;
  const byModel = new Map<string, number>();

  for (const event of events) {
    tokens += event.tokens;
    inputTokens += event.inputTokens ?? 0;
    outputTokens += event.outputTokens ?? 0;
    cacheTokens += (event.cacheReadTokens ?? 0) + (event.cacheWriteTokens ?? 0);
    byModel.set(event.model, (byModel.get(event.model) ?? 0) + event.tokens);

    if (config.billing !== 'metered') continue;
    const { amount } = estimateEventCost(event, resolveTokenRate(config, event.model));
    if (amount === null) {
      hasUnpricedEvents = true;
      continue;
    }
    meteredCost = (meteredCost ?? 0) + amount;
  }

  const monthlyCost = config.billing === 'subscription' && config.monthlyCost !== undefined
    ? config.monthlyCost
    : null;

  const periodCost = config.billing === 'metered'
    ? meteredCost
    : monthlyCost !== null && params.proratedDays !== undefined
      ? (monthlyCost / 30) * params.proratedDays
      : monthlyCost;

  const effectiveRatePerMillion = periodCost !== null && tokens > 0
    ? (periodCost / tokens) * TOKENS_PER_RATE_UNIT
    : null;

  return {
    providerId,
    billing: config.billing,
    meteredCost,
    monthlyCost,
    tokens,
    inputTokens,
    outputTokens,
    cacheTokens,
    runs: events.length,
    effectiveRatePerMillion,
    models: [...byModel.entries()]
      .map(([model, modelTokens]) => ({ model, tokens: modelTokens }))
      .sort((a, b) => b.tokens - a.tokens),
    hasUnpricedEvents,
    inputOnly: outputTokens === 0 && tokens > 0,
  };
}

/** Compact token label: 1234 → "1.2k", 1_500_000 → "1.5M". */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(tokens));
}

/** Currency label; null renders as an em dash so "unknown" never reads as "free". */
export function formatCost(amount: number | null, currency = DEFAULT_COST_CURRENCY): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  const fractionDigits = amount > 0 && amount < 1 ? 3 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: Math.min(2, fractionDigits),
    }).format(amount);
  } catch {
    return `${amount.toFixed(fractionDigits)} ${currency}`;
  }
}
