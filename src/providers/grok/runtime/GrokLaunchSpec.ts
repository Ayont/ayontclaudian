import type { GrokAgent, GrokPermissionMode } from '../settings';
import { normalizeGrokReasoningEffort } from '../types/models';

/**
 * Builds the command/args/cwd for a single-turn programmatic `grok -p` run with
 * newline-delimited JSON streaming.
 *
 * Verified `grok` v0.2 invocation:
 *   grok --output-format streaming-json -m <model> --cwd <cwd> \
 *     [--always-approve] [-r <session>] -p <prompt>
 *
 * `-p/--single <PROMPT>` is headless single-turn (prints the response, exits).
 * `--output-format streaming-json` emits one JSON delta event per stdout line.
 * `--always-approve` auto-approves tool calls (required for non-interactive
 * automation). The model is selected with the `-m`/`--model` flag.
 */

export interface BuildGrokLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Newline KEY=VALUE list, used only for launch-key hashing. */
  envText?: string;
  prompt: string;
  /** Model id passed via `-m`. */
  model: string;
  /**
   * `--reasoning-effort` value (`low` | `medium` | `high` | `xhigh`).
   * Omitted when empty or not offered for `model`.
   */
  reasoningEffort?: string | null;
  /** Reserved (kimi parity); grok derives its posture from permissionMode. */
  agent?: GrokAgent;
  /**
   * Named Grok bot for this turn (`--agent <NAME>`), resolved against the
   * catalog first. The CLI accepts an unknown name and then silently falls
   * back to the default agent, so never pass a name that was not verified —
   * see GrokAgentCatalog.resolveAgentName.
   */
  agentName?: string | null;
  /** Tool-approval posture mapped to grok flags. */
  permissionMode: GrokPermissionMode;
  /** Resume a specific session by id (`-r <id>`). */
  sessionId?: string | null;
}

export interface GrokLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

export function buildGrokLaunchSpec(params: BuildGrokLaunchSpecParams): GrokLaunchSpec {
  const args = ['--output-format', 'streaming-json'];

  const model = params.model?.trim();
  if (model) {
    args.push('-m', model);
  }

  const reasoningEffort = normalizeGrokReasoningEffort(params.reasoningEffort, model ?? '');
  if (reasoningEffort) {
    args.push('--reasoning-effort', reasoningEffort);
  }

  args.push('--cwd', params.cwd);

  // A named bot brings its own system prompt, tool set and permission mode.
  const agentName = params.agentName?.trim();
  if (agentName) {
    args.push('--agent', agentName);
  }

  // Tool-approval posture: yolo auto-approves. In plan/normal mode we do not
  // pass a headless approval flag so the run will respect the CLI's default
  // review behaviour and not hang on unknown flags.
  if (params.permissionMode === 'yolo') {
    args.push('--always-approve');
  }

  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    args.push('-r', sessionId);
  }

  // `-p <prompt>` is the headless single-turn prompt; pass it last.
  args.push('-p', params.prompt);

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      // Part of the key: a bot switch has to start a new process, because the
      // agent's system prompt is fixed for the life of the run.
      agentName: agentName ?? null,
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
      model: model ?? '',
      permissionMode: params.permissionMode,
      reasoningEffort: reasoningEffort ?? null,
      sessionId: sessionId ?? null,
    }),
  };
}
