import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the ZCode (`zcode`) provider.
 *
 * Supports persistent runtime, plan mode, image attachments,
 * reasoning control ('effort' with low/high/max), and multi-turn turns.
 */
export const ZCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'zcode',
  promptDelivery: 'session-preamble',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: true,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
});
