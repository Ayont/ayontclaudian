/**
 * Hermes reuses the shared ACP keepalive tuning.
 *
 * Hermes has the same silent-window problem as every other ACP agent —
 * provider/plugin discovery, credential-pool warmup, MCP discovery and long
 * `terminal` runs all produce no `session/update` — so there is no reason for it
 * to carry its own numbers. See `providers/acp/keepalive` for the rationale.
 */

export {
  ACP_KEEPALIVE_INTERVAL_MS as HERMES_KEEPALIVE_INTERVAL_MS,
  ACP_KEEPALIVE_MAX_SILENCE_MS as HERMES_KEEPALIVE_MAX_SILENCE_MS,
} from '../../acp/keepalive';
