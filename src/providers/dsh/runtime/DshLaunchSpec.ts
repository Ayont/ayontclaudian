/**
 * Builds the command/args/cwd for a single-turn
 * 
'dsh --profile headless <task>'
 * run.
 *
 * Verified dsh 0.1.1-rc.2 invocation:
 *   dsh --profile headless 'answer one task, print the final assistant
 *   message, and exit'
 *
 * The task is a commander positional ([task...]) whose words are joined with
 * spaces; passing the whole prompt as ONE argv token preserves newlines and
 * prevents any prompt text from being misread as an option.
 */

export interface BuildDshLaunchSpecParams {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Newline KEY=VALUE list, used only for launch-key hashing. */
  envText?: string;
  prompt: string;
}

export interface DshLaunchSpec {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  launchKey: string;
}

export function buildDshLaunchSpec(params: BuildDshLaunchSpecParams): DshLaunchSpec {
  const args = ['--profile', 'headless', params.prompt];

  return {
    args,
    command: params.command,
    cwd: params.cwd,
    env: params.env,
    // Identifies a launch CONFIGURATION (grok convention): payload-independent,
    // so reuse/dedupe logic sees equal keys for equal setups.
    launchKey: JSON.stringify({
      command: params.command,
      cwd: params.cwd,
      envText: params.envText ?? '',
    }),
  };
}
