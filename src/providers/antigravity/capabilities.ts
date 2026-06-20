import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Antigravity (`agy`) CLI provider.
 *
 * agy (>= 1.0.9) exposes single-shot `--print` output plus a per-conversation
 * `transcript.jsonl`, native resume (`--conversation <id>`), model selection
 * (`--model "<name>"`), and multimodal file reading via `@path` mentions — so
 * images/PDFs/files are uploadable (staged to a temp dir + referenced). It has
 * no JSON stream mode, no MCP tool bridging, and no plan/rewind/fork support.
 */
export const ANTIGRAVITY_PROVIDER_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: 'antigravity',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,
  supportsProviderCommands: true,
  supportsImageAttachments: true,
  supportsInstructionMode: false,
  supportsMcpTools: false,
  supportsMultiAgent: true,
  supportsTurnSteer: true,
  reasoningControl: 'none',
});
