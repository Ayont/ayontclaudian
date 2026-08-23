/**
 * Keepalive tuning for the Hermes ACP runtime.
 *
 * Hermes streams assistant text incrementally, but everything before the first
 * token is silent on the wire: provider/plugin discovery, credential-pool
 * warmup, MCP discovery and long `terminal` tool runs all produce no
 * `session/update` at all. The chat watchdog treats 120s of chunk silence as a
 * hang and force-cancels the turn.
 *
 * While a turn is in flight the runtime emits a `{ type: 'keepalive' }`
 * heartbeat every {@link HERMES_KEEPALIVE_INTERVAL_MS}. Heartbeats stop after
 * {@link HERMES_KEEPALIVE_MAX_SILENCE_MS} without real wire activity, so a
 * genuinely dead turn still trips the watchdog (cap + 120s).
 */

/** How often a heartbeat is emitted while the turn is silently working (ms). */
export const HERMES_KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * Hard cap: no real wire activity for this long stops the heartbeats and hands
 * hang detection back to the watchdog (ms).
 */
export const HERMES_KEEPALIVE_MAX_SILENCE_MS = 15 * 60_000;
