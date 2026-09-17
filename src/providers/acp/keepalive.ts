/**
 * Keepalive tuning shared by the ACP runtimes.
 *
 * ACP agents stream assistant text incrementally, but everything that happens
 * before the first token is silent on the wire: provider/plugin discovery,
 * credential warmup, MCP discovery, and — the common case — a long-running
 * `terminal` or `bash` tool call. None of those emit a `session/update`. The
 * chat watchdog treats 120s of chunk silence as a hang and force-cancels the
 * turn, so a healthy-but-slow turn would be killed.
 *
 * While a turn is in flight the runtime emits a `{ type: 'keepalive' }`
 * heartbeat every {@link ACP_KEEPALIVE_INTERVAL_MS}. Heartbeats stop after
 * {@link ACP_KEEPALIVE_MAX_SILENCE_MS} without real wire activity, so a
 * genuinely dead turn still trips the watchdog (cap + the watchdog's own 120s)
 * instead of hanging forever.
 */

/** How often a heartbeat is emitted while the turn is silently working (ms). */
export const ACP_KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * Hard cap: no real wire activity for this long stops the heartbeats and hands
 * hang detection back to the watchdog (ms).
 */
export const ACP_KEEPALIVE_MAX_SILENCE_MS = 15 * 60_000;
