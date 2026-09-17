import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';

/**
 * Oh My Pi keeps all of its state under `~/.omp` and has no database-path
 * environment override (that was Opencode's `OPENCODE_DB`). The only OMP-owned
 * variable worth honouring here is `OMP_PROFILE`, which the user can set
 * through the provider's environment settings like any other variable.
 */
export function buildOmpRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, 'omp');
  const envVars = parseEnvironmentVariables(envText);
  return {
    ...process.env,
    ...envVars,
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
