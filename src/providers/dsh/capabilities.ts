import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the DeepSeek Harness (`dsh`) provider.
 *
 * The headless profile answers one task per invocation with plain text on
 * stdout (verified against dsh 0.1.1-rc.2): no streaming deltas, no resume
 * flag, no transcript the plugin can read (zstd-compressed), and no
 * launch-time model selection. Conversation continuity is client-side history
 * replay; vault commands/skills are expanded client-side like grok.
 */
export const DSH_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'dsh',
  promptDelivery: 'stateless-turn',
  supportsPersistentRuntime: true,
  supportsNativeHistory: false,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: false,
  supportsTurnSteer: false,
  reasoningControl: 'none',
});
