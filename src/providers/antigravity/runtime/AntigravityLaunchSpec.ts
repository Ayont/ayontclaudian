import type { AntigravityPermissionMode, AntigravityWorkspaceScope } from '../settings';

/**
 * Builds the command/args/cwd for a single-shot `agy` print-mode run.
 *
 * Verified `agy` v1.0.8 invocation (`agy --help`):
 *   agy --add-dir <vaultPath> \
 *       (--dangerously-skip-permissions | --sandbox) \
 *       [--add-dir <home>] [--print-timeout <v>] \
 *       [--conversation <id>] -p "<prompt>"
 *
 * CRITICAL — `agy` uses Go's `flag` package, where `-p` / `--print` /
 * `--prompt` is a STRING flag whose value IS the prompt. `agy --print` with no
 * value fails: "flag needs an argument: -print". Go's flag parser also stops at
 * the first bare positional, so a `--` terminator followed by the prompt would
 * silently drop every flag after the first positional. Therefore the prompt
 * must be passed as the value of `-p` (placed last, after all other flags), and
 * there must be NO `--` terminator.
 *
 * Permission posture is mutually exclusive:
 *   - `yolo`    -> `--dangerously-skip-permissions` (default; required for the
 *                  unattended print mode, which cannot answer prompts).
 *   - `sandbox` -> `--sandbox`, and the skip-permissions flag is omitted.
 *
 * Under a non-TTY stdout (a spawned child process), `agy` prints no final text
 * to stdout; the structured event stream is read from the per-conversation
 * transcript.jsonl instead.
 */

export interface BuildAntigravityLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Newline KEY=VALUE list, used only for launch-key hashing. */
  envText?: string;
  prompt: string;
  /** Resume an existing conversation by id, when known. */
  conversationId?: string | null;
  /**
   * Permission posture. `yolo` (default) adds `--dangerously-skip-permissions`;
   * `sandbox` adds `--sandbox` and omits the skip-permissions flag.
   */
  permissionMode?: AntigravityPermissionMode;
  /** `--print-timeout <value>` (e.g. `10m`); empty/undefined leaves it unset. */
  printTimeout?: string;
  /** Filesystem scope; `allow-home` adds `--add-dir <homeDir>`. */
  workspaceScope?: AntigravityWorkspaceScope;
  /** Home directory to add when `workspaceScope === 'allow-home'`. */
  homeDir?: string;
}

export interface AntigravityLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

export function buildAntigravityLaunchSpec(
  params: BuildAntigravityLaunchSpecParams,
): AntigravityLaunchSpec {
  // Default to YOLO so unattended `--print` runs (and aux one-shots that pass
  // no posture) keep the prior always-on `--dangerously-skip-permissions`.
  const permissionMode: AntigravityPermissionMode = params.permissionMode ?? 'yolo';
  // Prompt is appended last as the value of `-p` (see the file header). Every
  // other flag must precede it.
  const args = ['--add-dir', params.cwd];

  // YOLO skips permission prompts; sandbox runs inside agy's OS sandbox and
  // never skips. The two postures are mutually exclusive.
  if (permissionMode === 'sandbox') {
    args.push('--sandbox');
  } else {
    args.push('--dangerously-skip-permissions');
  }

  // allow-home roaming: add the home directory as an extra accessible root.
  // Skip it when home equals the vault (avoids a redundant duplicate flag).
  const homeDir = params.homeDir?.trim();
  if (params.workspaceScope === 'allow-home' && homeDir && homeDir !== params.cwd) {
    args.push('--add-dir', homeDir);
  }

  const printTimeout = params.printTimeout?.trim();
  if (printTimeout) {
    args.push('--print-timeout', printTimeout);
  }

  const conversationId = params.conversationId?.trim();
  if (conversationId) {
    args.push('--conversation', conversationId);
  }

  // `-p <prompt>`: the prompt is the VALUE of the print flag, placed last so
  // every preceding flag is parsed before Go's `flag` package consumes it.
  // No `--` terminator (it would strand the prompt as a dropped positional).
  args.push('-p', params.prompt);

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    launchKey: JSON.stringify({
      command: params.command,
      conversationId: conversationId ?? null,
      cwd: params.cwd,
      envText: params.envText ?? '',
      permissionMode,
      printTimeout: printTimeout ?? '',
      workspaceScope: params.workspaceScope ?? 'vault-only',
      homeDir: params.workspaceScope === 'allow-home' ? (homeDir ?? '') : '',
    }),
  };
}
