import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { getEnhancedPath, parseEnvironmentVariables } from '../../../utils/env';
import { CLINE_PROVIDER_ID } from '../settings';

export function buildClineRuntimeEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const envText = getRuntimeEnvironmentText(settings, CLINE_PROVIDER_ID);
  const envVars = parseEnvironmentVariables(envText);
  return {
    ...process.env,
    ...envVars,
    CLINE_NO_AUTO_UPDATE: envVars.CLINE_NO_AUTO_UPDATE ?? '1',
    PATH: getEnhancedPath(envVars.PATH, cliPath || undefined),
  };
}
