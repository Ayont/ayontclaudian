import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Freebuff provider.
 *
 * Turns run inside the Freebuff desktop app over its loopback HTTP API
 * (verified live against Freebuff.app 0.0.154): threads persist there, the
 * event stream carries real token metrics, but there is no native transcript
 * hydration surface for the plugin and image attachments were not exercised
 * end-to-end, so those stay off until verified.
 */
export const FREEBUFF_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'freebuff',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: false,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: false,
  supportsTurnSteer: false,
  reasoningControl: 'none',
});