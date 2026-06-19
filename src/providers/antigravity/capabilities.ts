import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Antigravity (`agy`) CLI provider.
 *
 * Antigravity v1.0.3 exposes only single-shot `--print` text output plus a
 * per-conversation `transcript.jsonl`. It has native conversation resume
 * (`--conversation <id>`) but no JSON stream mode, no model-selection flag,
 * no MCP tool bridging, and no plan/rewind/fork support.
 */
export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'antigravity',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: false,
  supportsTurnSteer: true,
  reasoningControl: 'none',
});
