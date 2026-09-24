import type { ProviderCapabilities } from '../../core/providers/types';

export const PI_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'pi',
  promptDelivery: 'native-system',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: true,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
  // PiChatRuntime sends the RPC `compact` command (pi docs/rpc.md, modes/rpc/rpc-mode.js).
  compact: Object.freeze({ command: '/compact', availability: 'builtin' }),
  // `compaction.enabled` defaults to true (pi docs/settings.md, 0.85.1).
  autoCompact: true,
});
