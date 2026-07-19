/**
 * Keepalive tuning shared by both Kimi runtimes (stream-json + ACP).
 *
 * Kimi's wire protocols carry NO incremental deltas: stream-json emits one
 * COMPLETE message per NDJSON line, and ACP only notifies on finished
 * updates. Heavy reasoning models (Kimi K3) can think for minutes between
 * lines — total silence on the wire while the CLI is perfectly healthy. The
 * chat stream watchdog treats 120s of chunk silence as a hang and would
 * force-cancel the turn ("Timeout nach 2 automatischen Versuchen").
 *
 * While the underlying process/turn is alive, the runtimes emit a
 * `{ type: 'keepalive' }` heartbeat chunk every {@link KIMI_KEEPALIVE_INTERVAL_MS}
 * so the watchdog knows work is in progress. Heartbeats STOP after
 * {@link KIMI_KEEPALIVE_MAX_SILENCE_MS} without any real wire activity, so a
 * genuinely hung process still trips the watchdog eventually (cap + 120s).
 */

/** How often a heartbeat is emitted while the turn is silently working (ms). */
export const KIMI_KEEPALIVE_INTERVAL_MS = 20_000;

/**
 * Hard cap: no real wire activity for this long stops the heartbeats and
 * hands hang detection back to the watchdog (ms).
 */
export const KIMI_KEEPALIVE_MAX_SILENCE_MS = 15 * 60_000;
