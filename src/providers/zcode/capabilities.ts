import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the ZCode (`zcode`) provider.
 *
 * Supports persistent runtime, image attachments, reasoning control
 * ('effort' with low/high/max), and multi-turn turns.
 *
 * The runtime posts to the Messages API with no tools, so neither a plan
 * posture nor the in-chat MCP selection changes anything; both controls stay
 * hidden instead of pretending.
 */
export const ZCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'zcode',
  promptDelivery: 'session-preamble',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
});
