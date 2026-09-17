import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Verified against `omp acp` v18.2.3 by driving a real ACP handshake:
 *
 * - `initialize` → `agentCapabilities`: `loadSession: true`,
 *   `promptCapabilities: { embeddedContext: true, image: true }`,
 *   `mcpCapabilities: { http: true, sse: true }`,
 *   `sessionCapabilities: { list, fork, resume, close }`.
 * - `session/new` → `configOptions`: `mode` (category `mode`: `default`, `plan`),
 *   `model` (category `model`, 666 entries), `thinking` (category
 *   `thought_level`, 7 levels) — so plan mode and effort are both real.
 * - `--append-system-prompt` is accepted alongside the `acp` subcommand, which
 *   is what makes `native-system` prompt delivery truthful here.
 *
 * `supportsFork` and `supportsMcpTools` stay false on purpose. The agent
 * advertises both, but Claudian has no OMP-side fork wiring yet and the runtime
 * still sends `mcpServers: []` on `session/new`. Declaring a capability the
 * runtime cannot service is exactly how providers have shipped broken before;
 * flip these together with the wiring, not ahead of it.
 */
export const OMP_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'omp',
  promptDelivery: 'native-system',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
});
