import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Antigravity (`agy`) CLI provider.
 *
 * agy (>= 1.0.9) exposes single-shot `--print` output plus a per-conversation
 * `transcript.jsonl`, native resume (`--conversation <id>`), model selection
 * (`--model "<name>"`), a builtin persona picker (`--agent <name>`, agy >=
 * 1.1.1, see `agy agents`), and multimodal file reading via `@path` mentions —
 * so images/PDFs/files are uploadable (staged to a temp dir + referenced). It
 * has no JSON stream mode, no MCP tool bridging, and no rewind/fork support.
 *
 * `--mode` (agy >= 1.1.0: default/request-review, accept-edits, plan) and the
 * standalone `--effort` flag (agy >= 1.1.5) are deliberately NOT wired yet:
 * `--mode plan` has no structured "plan proposed, awaiting approval" signal
 * over agy's plain-text transcript the way `supportsPlanMode` elsewhere
 * assumes (an SDK tool call the runtime can intercept), and plan mode is
 * inherently an interactive back-and-forth that doesn't fit a single-shot
 * `--print` turn. `--effort` would need to compose with model-name-encoded
 * effort (e.g. "Gemini 3.6 Flash (High)") without conflicting; reasoning
 * effort stays baked into the model name for now (see AntigravityChatUIConfig).
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
