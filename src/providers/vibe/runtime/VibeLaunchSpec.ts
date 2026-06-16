import type { VibeAgent, VibePermissionMode } from '../settings';

/**
 * Builds the command/args/cwd for a single-turn programmatic `vibe -p` run with
 * newline-delimited JSON streaming.
 *
 * Verified `vibe` v2.16 invocation:
 *   vibe --output streaming --trust --agent <preset> \
 *     --workdir <cwd> --add-dir <cwd> [--resume <session>] -p <prompt>
 *
 * `-p/--prompt` is programmatic mode (run prompt, emit response, exit).
 * `--output streaming` emits one JSON `LLMMessage` per stdout line. `--trust`
 * skips the workspace-trust prompt (required for non-interactive automation).
 * `--agent` selects the tool-approval posture. The model is NOT a flag; it is
 * passed via the `VIBE_ACTIVE_MODEL` environment variable (see env builder).
 */

export interface BuildVibeLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Newline KEY=VALUE list, used only for launch-key hashing. */
  envText?: string;
  prompt: string;
  /** Active model id (applied via VIBE_ACTIVE_MODEL env; here only for hashing). */
  model: string;
  /** Reserved (kimi parity); vibe derives its agent from permissionMode. */
  agent?: VibeAgent;
  /** Tool-approval posture mapped to a vibe `--agent` preset. */
  permissionMode: VibePermissionMode;
  /** Resume a specific session by id (`--resume <id>`). */
  sessionId?: string | null;
}

export interface VibeLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

/** Maps Claudian's permission posture to a vibe builtin `--agent` preset. */
function vibeAgentForMode(mode: VibePermissionMode): string {
  switch (mode) {
    case 'plan':
      return 'plan';
    case 'yolo':
      return 'auto-approve';
    default:
      return 'default';
  }
}

export function buildVibeLaunchSpec(params: BuildVibeLaunchSpecParams): VibeLaunchSpec {
  const agentPreset = vibeAgentForMode(params.permissionMode);
  const args = ['--output', 'streaming', '--trust', '--agent', agentPreset];

  // Confine + trust the vault directory for this run.
  args.push('--workdir', params.cwd, '--add-dir', params.cwd);

  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  // `-p <prompt>` is the programmatic prompt; pass it last so a leading dash in
  // the prompt is never mistaken for a flag.
  args.push('-p', params.prompt);

  const model = params.model?.trim();

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      agent: agentPreset,
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
      model: model ?? '',
      permissionMode: params.permissionMode,
      sessionId: sessionId ?? null,
    }),
  };
}
