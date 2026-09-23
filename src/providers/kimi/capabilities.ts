import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Kimi (`kimi-cli`) provider.
 *
 * Kimi CLI supports true line-delimited JSON streaming
 * (`--print --output-format stream-json`), native session resume
 * (`--session` / `--continue`), real model selection (`-m`), plan mode
 * (`--plan`), MCP bridging (`--mcp-config-file`), and vision-capable models
 * (config caps `image_in`). Thinking is a binary `--thinking` / `--no-thinking`
 * control; the shared `reasoningControl` enum only allows
 * `'effort' | 'token-budget' | 'none'`, so the on/off toggle is modeled as an
 * `'effort'` control exposing exactly two options (see `KimiChatUIConfig`).
 *
 * `supportsMcpTools` is false: print mode passes the fixed `--mcp-config-file`
 * from settings and ACP mode Claudian's always-on servers per session; neither
 * can apply the in-chat selector's per-turn choice.
 */
export const KIMI_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'kimi',
  promptDelivery: 'session-preamble',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: true,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'effort',
  // kimi-code 2.1 runs `/goal <objective>` headless until complete (exit 0),
  // blocked (3) or paused (6). Only the print runtime; ACP has no goal command.
  nativeGoal: { mode: 'slash' as const, canPause: false, persistent: true, resume: 'resend' as const },
});
