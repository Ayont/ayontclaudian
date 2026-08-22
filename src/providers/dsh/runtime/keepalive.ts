/**
 * Keepalive tuning for the dsh headless runtime.
 *
 * The headless profile prints NOTHING until the final assistant message —
 * zero stdout/stderr while the agent works through tools (verified against
 * real runs; a trivial file-creating task stays silent for its whole
 * duration). The chat stream watchdog treats sustained chunk silence as a
 * hang and would force-cancel healthy turns.
 *
 * While the spawned process is alive the runtime emits a
 * `{ type: 'keepalive' }` heartbeat every
 * {@link DSH_KEEPALIVE_INTERVAL_MS}. Heartbeats stop after
 * {@link DSH_KEEPALIVE_MAX_SILENCE_MS} WITHOUT any real wire activity so a
 * genuinely hung process still trips the watchdog eventually (cap + 120s).
 * The cap is deliberately generous: agentic vault tasks routinely run many
 * minutes with silence BY DESIGN here, unlike kimi where any NDJSON line
 * refreshes the window.
 */

/** How often a heartbeat is emitted while the turn is silently working (ms). */
export const DSH_KEEPALIVE_INTERVAL_MS = 20_000;

/** Hard cap: no real wire activity for this long stops the heartbeats (ms). */
export const DSH_KEEPALIVE_MAX_SILENCE_MS = 30 * 60_000;
