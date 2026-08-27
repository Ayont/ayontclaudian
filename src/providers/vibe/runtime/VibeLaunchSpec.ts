import * as path from 'node:path';

import type { VibeAgent, VibePermissionMode } from '../settings';

/**
 * Builds the command/args/cwd for a single-turn programmatic `vibe -p` run.
 *
 * Verified `vibe` 2.20.0 (`vibe --help`):
 *   vibe --output streaming --trust --agent <preset> [--yolo] \
 *     --workdir <cwd> --add-dir <cwd> \
 *     [--max-turns N] [--max-tokens N] [--resume <id>] -p <prompt>
 *
 * There is no `--print` / `--output-format stream-json` / `-m` / `--thinking`
 * flag on 2.20. Model is `VIBE_ACTIVE_MODEL`. Custom agents are
 * `--agent NAME` → `~/.vibe/agents/NAME.toml`.
 */

export interface BuildVibeLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  envText?: string;
  prompt: string;
  model: string;
  agent?: VibeAgent | string;
  /** Optional path to `~/.vibe/agents/NAME.toml`; basename becomes `--agent`. */
  agentFile?: string;
  permissionMode: VibePermissionMode;
  sessionId?: string | null;
  maxTurns?: number;
  maxTokens?: number;
  /** Adds Vibe's workspace-trust bypass. Disable for hidden/read-only auxiliary work. */
  trustWorkspace?: boolean;
}

export interface VibeLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

function vibeAgentForMode(mode: VibePermissionMode, preferred?: string, agentFile?: string): string {
  if (mode === 'plan') {
    return 'plan';
  }
  if (mode === 'yolo') {
    return 'auto-approve';
  }
  const fromFile = agentFile?.trim()
    ? path.basename(agentFile.trim()).replace(/\.toml$/i, '')
    : '';
  const named = (preferred ?? '').trim();
  if (fromFile) {
    return fromFile;
  }
  if (named && named !== 'default') {
    return named;
  }
  return 'default';
}

export function buildVibeLaunchSpec(params: BuildVibeLaunchSpecParams): VibeLaunchSpec {
  const agentPreset = vibeAgentForMode(params.permissionMode, params.agent, params.agentFile);
  const args = ['--output', 'streaming'];
  if (params.trustWorkspace !== false) {
    args.push('--trust');
  }
  args.push('--agent', agentPreset);

  // YOLO is a separate flag on 2.20 and is what actually skips tool prompts.
  if (params.permissionMode === 'yolo') {
    args.push('--yolo');
  }

  args.push('--workdir', params.cwd, '--add-dir', params.cwd);

  if (params.maxTurns && params.maxTurns > 0) {
    args.push('--max-turns', String(Math.round(params.maxTurns)));
  }
  if (params.maxTokens && params.maxTokens > 0) {
    args.push('--max-tokens', String(Math.round(params.maxTokens)));
  }

  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    args.push('--resume', sessionId);
  }

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
      maxTokens: params.maxTokens ?? 0,
      maxTurns: params.maxTurns ?? 0,
      model: model ?? '',
      permissionMode: params.permissionMode,
      sessionId: sessionId ?? null,
      trustWorkspace: params.trustWorkspace !== false,
    }),
  };
}
