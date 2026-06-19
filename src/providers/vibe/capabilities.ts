import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Vibe (`vibe`) provider.
 *
 * Vibe CLI supports true line-delimited JSON streaming
 * (`--print --output-format stream-json`), native session resume
 * (`--session` / `--continue`), real model selection (`-m`), plan mode
 * (`--plan`), MCP bridging (`--mcp-config-file`), and vision-capable models
 * (config caps `image_in`). Thinking is a binary `--thinking` / `--no-thinking`
 * control; the shared `reasoningControl` enum only allows
 * `'effort' | 'token-budget' | 'none'`, so the on/off toggle is modeled as an
 * `'effort'` control exposing exactly two options (see `VibeChatUIConfig`).
 */
export const VIBE_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'vibe',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
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
