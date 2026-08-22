/**
 * Watchdog tuning for Freebuff turns.
 *
 * Mirrors the dsh values: the desktop agent can think (or run tools) for a
 * long time without emitting a text delta for THIS thread — the shared event
 * bus still delivers other traffic, but silence must not kill the turn.
 */
export const FREEBUFF_KEEPALIVE_INTERVAL_MS = 20_000;
export const FREEBUFF_KEEPALIVE_MAX_SILENCE_MS = 30 * 60_000;