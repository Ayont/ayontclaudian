import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { getHermesProviderSettings, HERMES_PROVIDER_ID } from '../settings';

/**
 * `hermes acp` exposes almost no flags of its own; the CLI's global switches
 * are implemented by exporting env vars before the agent boots (see
 * `hermes_cli/main.py`). Passing those vars directly to the subprocess is the
 * same mechanism, minus any assumption about argparse ordering.
 */
export function buildHermesRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const hermesSettings = getHermesProviderSettings(settings);
  const envText = getRuntimeEnvironmentText(settings, HERMES_PROVIDER_ID);
  const envVars = parseEnvironmentVariables(envText);

  return {
    ...process.env,
    ...envVars,
    // `tools/approval.py` freezes this at import time, so it must be present
    // in the child's environment rather than toggled later.
    ...(hermesSettings.yoloMode ? { HERMES_YOLO_MODE: '1' } : {}),
    ...(hermesSettings.acceptHooks ? { HERMES_ACCEPT_HOOKS: '1' } : {}),
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
