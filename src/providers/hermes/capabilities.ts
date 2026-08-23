import type { ProviderCapabilities } from '../../core/providers/types';
import { HERMES_PROVIDER_ID } from './settings';

/**
 * Verified against `hermes acp` (Hermes Agent v0.20.5):
 * - `initialize` advertises `loadSession`, `promptCapabilities.image`, and
 *   session `fork` / `list` / `resume`.
 * - `session/update` carries `available_commands_update` (9 commands),
 *   `usage_update` (authoritative context window) and tool-call streams.
 * - `session/set_model` switches models mid-session; there is no reasoning or
 *   plan-mode control on the ACP surface, so both stay off.
 */
export const HERMES_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: HERMES_PROVIDER_ID,
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'none',
});
