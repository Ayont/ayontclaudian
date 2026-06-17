import type { KimiAgent, KimiPermissionMode } from '../settings';

/**
 * Builds the command/args/cwd for a single-turn Kimi run with line-delimited
 * JSON streaming.
 *
 * Modern Kimi Code (`~/.kimi-code/bin/kimi`) prompt-mode invocation:
 *   kimi -m <model> -S <session-id> -p <prompt> --output-format stream-json
 *
 * Verified legacy `kimi-cli` v1.47 invocation:
 *   kimi-cli --print --output-format stream-json -m <model> \
 *     [--thinking | --no-thinking] [--agent <a>] [--agent-file <f>] \
 *     [--mcp-config-file <f>] [--continue | --session <id>] \
 *     --add-dir <vaultPath> --work-dir <vaultPath> -p <prompt>
 *
 * `--print` / prompt mode is non-interactive, so we intentionally do not pass
 * `--yolo` or `--plan`: modern Kimi Code rejects `--prompt` + `--yolo`, and
 * legacy print mode already auto-dismisses questions for the invocation.
 */

export interface BuildKimiLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Newline KEY=VALUE list, used only for launch-key hashing. */
  envText?: string;
  prompt: string;
  /** Real `-m` model id. */
  model: string;
  /** `--thinking` (true) vs `--no-thinking` (false). */
  thinking: boolean;
  /** Builtin `--agent` preset. */
  agent: KimiAgent;
  /** Optional `--agent-file` path. */
  agentFile?: string;
  /** Optional `--mcp-config-file` path. */
  mcpConfigFile?: string;
  /** `--yolo` / `--plan` posture; `'normal'` adds neither (print auto-approves). */
  permissionMode: KimiPermissionMode;
  /** Resume a specific session by id (`--session <id>`). */
  sessionId?: string | null;
  /** Resume the most recent session for the cwd (`--continue`) when no id. */
  resume?: boolean;
  /** Suppress reasoning regardless of `thinking` (used by aux one-shots). */
  forceNoThinking?: boolean;
}

export interface KimiLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

export type KimiCliFlavor = 'kimi-code' | 'legacy';

function normalizedCommandPath(command: string): string {
  return command.replace(/\\/g, '/').toLowerCase();
}

/**
 * Best-effort CLI flavor detection.
 *
 * The modern product installs a binary named `kimi` under `~/.kimi-code/bin`
 * and does NOT support legacy `--print`/`--agent` flags. The uv legacy tool
 * exposes `kimi-cli` / `kimi-legacy` and still supports those flags.
 */
export function detectKimiCliFlavor(command: string): KimiCliFlavor {
  const normalized = normalizedCommandPath(command);
  const base = normalized.split('/').pop() ?? normalized;
  if (base === 'kimi-cli' || base === 'kimi-legacy' || normalized.includes('/kimi-cli/')) {
    return 'legacy';
  }
  return 'kimi-code';
}

export function buildKimiLaunchSpec(params: BuildKimiLaunchSpecParams): KimiLaunchSpec {
  const flavor = detectKimiCliFlavor(params.command);
  const args = flavor === 'legacy'
    ? ['--print', '--output-format', 'stream-json']
    : ['--output-format', 'stream-json'];

  const model = params.model?.trim();
  if (model) {
    args.push('-m', model);
  }

  if (flavor === 'legacy') {
    if (params.forceNoThinking || !params.thinking) {
      args.push('--no-thinking');
    } else {
      args.push('--thinking');
    }

    args.push('--agent', params.agent);

    const agentFile = params.agentFile?.trim();
    if (agentFile) {
      args.push('--agent-file', agentFile);
    }

    const mcpConfigFile = params.mcpConfigFile?.trim();
    if (mcpConfigFile) {
      args.push('--mcp-config-file', mcpConfigFile);
    }
  }

  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    args.push(flavor === 'legacy' ? '--session' : '-S', sessionId);
  } else if (params.resume) {
    args.push('--continue');
  }

  if (flavor === 'legacy') {
    args.push('--add-dir', params.cwd, '--work-dir', params.cwd);
  }

  // `-p <prompt>` is the non-interactive prompt; passing it last keeps the
  // prompt from being mistaken for a flag value.
  args.push('-p', params.prompt);

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      agent: params.agent,
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
      flavor,
      model: model ?? '',
      permissionMode: params.permissionMode,
      sessionId: sessionId ?? null,
      thinking: params.forceNoThinking ? false : params.thinking,
    }),
  };
}
