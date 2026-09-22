import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Grok (`grok`) provider.
 *
 * Grok CLI supports true line-delimited JSON streaming
 * (`--print --output-format stream-json`), native session resume
 * (`--session` / `--continue`), real model selection (`-m`), plan mode
 * (`--plan`), MCP bridging (`--mcp-config-file`), and vision-capable models
 * (config caps `image_in`). Reasoning effort is `--reasoning-effort`
 * (`low` | `medium` | `high` | `xhigh`); the shared control is `'effort'`.
 */
export const GROK_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'grok',
  promptDelivery: 'session-preamble',
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
