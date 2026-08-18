import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Vibe (`vibe`) provider.
 *
 * Verified against `vibe` 2.20.0: programmatic mode is `-p --output streaming`
 * (not `--print --output-format stream-json`). Resume is `--resume <id>`.
 * Model is `VIBE_ACTIVE_MODEL`. Plan/YOLO are `--agent plan` / `--agent
 * auto-approve --yolo`. MCP lives in `~/.vibe/config.toml`, not a CLI flag.
 * Thinking is per-model in that config (`thinking = "high"`), not `--thinking`.
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
