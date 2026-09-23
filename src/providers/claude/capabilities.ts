import type { ProviderCapabilities } from '../../core/providers/types';

export const CLAUDE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'claude',
  promptDelivery: 'native-system',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: true,
  supportsFork: true,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: true,
  supportsMcpTools: true,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
  planPathPrefix: '/.claude/plans/',
  // Claude Code 2.1.280: `/goal` is a non-interactive built-in; its Stop hook
  // keeps the answer going until the condition holds. It has no pause.
  nativeGoal: { mode: 'slash' as const, canPause: false, persistent: false, clearCommand: '/goal clear', resume: 'next-turn' as const },
  // Built-in SDK slash command; the turn ends in a `compact_boundary` system
  // message (sdk.d.ts), which the runtime maps to `context_compacted`.
  compact: Object.freeze({ command: '/compact', availability: 'builtin' }),
});
