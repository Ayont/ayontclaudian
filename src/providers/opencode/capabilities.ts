import type { ProviderCapabilities } from '../../core/providers/types';

export const OPENCODE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'opencode',
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
  // `opencode acp` (verified 1.18.32) answers a `/compact` prompt with
  // `session.summarize`, even though the command is not in its advertised list.
  compact: Object.freeze({ command: '/compact', availability: 'builtin' }),
});
