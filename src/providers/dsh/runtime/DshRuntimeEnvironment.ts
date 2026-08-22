import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { DSH_PROVIDER_ID,getDshProviderSettings } from '../settings';

/**
 * Builds the spawn environment for the `dsh` CLI.
 *
 * Layers the process env, then the user-configured provider/shared environment
 * variables (`DSH_*`), then an optional alternate DSH_HOME (the boot layer
 * honors it), then an enhanced PATH so the CLI and its child tools can be
 * located.
 */
export function buildDshRuntimeEnv(
  settingsBag: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envVars = parseEnvironmentVariables(getRuntimeEnvironmentText(settingsBag, DSH_PROVIDER_ID));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
  const { dshHome } = getDshProviderSettings(settingsBag);
  if (dshHome) {
    env.DSH_HOME = dshHome;
  }
  return env;
}
