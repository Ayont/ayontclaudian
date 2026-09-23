import type { ProviderCapabilities } from '../../core/providers/types';

export const CODEX_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'codex',
  promptDelivery: 'native-system',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: true,
  supportsProviderCommands: false,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
  // codex-cli 0.156: `features list` → goals stable; app-server thread/goal/set|get|clear.
  nativeGoal: { mode: 'rpc' as const, canPause: true, persistent: true, resume: 'rpc' as const },
  // CodexChatRuntime routes a bare `/compact` to app-server `thread/compact/start`.
  compact: Object.freeze({ command: '/compact', availability: 'builtin' }),
});
