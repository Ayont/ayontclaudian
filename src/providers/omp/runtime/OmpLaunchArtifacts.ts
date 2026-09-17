import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';

/**
 * Oh My Pi takes its prompt through the CLI, not through a generated config
 * file: `--append-system-prompt` is a *global* flag and stays in effect for the
 * `acp` subcommand (verified against omp v18.2.3 — `omp acp
 * --append-system-prompt …` completes the ACP `initialize` handshake normally).
 *
 * The value is passed as literal text rather than a file path. The flag's help
 * ("Append text or file contents to the system prompt") leaves the path form
 * ambiguous, and text is unambiguously supported, so there is nothing to guess.
 *
 * This is deliberately NOT the Opencode shape. Opencode needs a managed
 * `config.json` declaring `claudian-yolo` / `claudian-safe` agents because its
 * permission ladder lives in agent definitions. Oh My Pi has exactly two ACP
 * modes (`default`, `plan`) and gates writes through ACP permission requests,
 * so there is no config to synthesize.
 */
export interface OmpLaunchArtifacts {
  /** Restart key: a change here means the running process is stale. */
  launchKey: string;
  /** Passed verbatim to `--append-system-prompt`. */
  systemPromptText: string;
}

export interface PrepareOmpLaunchArtifactsParams {
  settings?: SystemPromptSettings;
  systemPromptKey?: string;
  systemPromptText?: string;
}

export function prepareOmpLaunchArtifacts(
  params: PrepareOmpLaunchArtifactsParams,
): OmpLaunchArtifacts {
  const systemPromptText = params.systemPromptText
    ?? buildSystemPrompt(requireSettings(params));
  const promptKey = params.systemPromptKey
    ?? (params.systemPromptText !== undefined
      ? params.systemPromptText
      : computeSystemPromptKey(requireSettings(params)));

  return {
    launchKey: promptKey,
    systemPromptText,
  };
}

function requireSettings(
  params: PrepareOmpLaunchArtifactsParams,
): SystemPromptSettings {
  if (params.settings) {
    return params.settings;
  }

  throw new Error('prepareOmpLaunchArtifacts requires settings when no systemPromptText is provided');
}
