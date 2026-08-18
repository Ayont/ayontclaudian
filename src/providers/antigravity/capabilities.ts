import type { ProviderCapabilities } from '../../core/providers/types';

/**
 * Capabilities for the Antigravity (`agy`) CLI provider.
 *
 * agy (>= 1.0.9) exposes single-shot `--print` output plus a per-conversation
 * `transcript.jsonl`, native resume (`--conversation <id>`), model selection
 * (`--model "<name>"`), a builtin persona picker (`--agent <name>`, agy >=
 * 1.1.1, see `agy agents`), and multimodal file reading via `@path` mentions —
 * so images/PDFs/files are uploadable (staged to a temp dir + referenced).
 * agy >= 1.1.12 adds `--output-format stream-json` (live `text_delta`,
 * conversation id, token usage) which the runtime now uses; tool cards still
 * come from the transcript tail. There is no MCP tool bridging and no
 * rewind/fork support.
 *
 * `--mode` (agy >= 1.1.0: accept-edits, plan) is still not wired: `--mode plan`
 * has no structured "plan proposed, awaiting approval" signal the way
 * `supportsPlanMode` elsewhere assumes, and plan mode is an interactive
 * back-and-forth that does not fit a single-shot `--print` turn. `--effort`
 * (agy >= 1.1.5) stays unused because effort is already encoded in the model
 * name / slug (e.g. "Gemini 3.7 Flash (High)" / `gemini-3.7-flash-high`).
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
