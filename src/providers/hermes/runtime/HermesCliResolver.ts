import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { getHermesProviderSettings, HERMES_PROVIDER_ID } from '../settings';

export class HermesCliResolver {
  private readonly cachedHostname = getHostnameKey();
  private lastCliPath = '';
  private lastHostnamePath = '';
  private lastEnvText = '';
  private resolvedPath: string | null = null;
  // A miss (null) is a valid cache entry too, otherwise a missing CLI rescans
  // PATH on every settings read.
  private hasResolved = false;

  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const hermesSettings = getHermesProviderSettings(settings);
    const cliPath = hermesSettings.cliPath.trim();
    const hostnamePath = (hermesSettings.cliPathsByHost[this.cachedHostname] ?? '').trim();
    const envText = getRuntimeEnvironmentText(settings, HERMES_PROVIDER_ID);

    if (
      this.hasResolved
      && cliPath === this.lastCliPath
      && hostnamePath === this.lastHostnamePath
      && envText === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastCliPath = cliPath;
    this.lastHostnamePath = hostnamePath;
    this.lastEnvText = envText;
    this.resolvedPath = this.resolve(hermesSettings.cliPathsByHost, cliPath, envText);
    this.hasResolved = true;
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: Record<string, string> | undefined,
    legacyPath: string,
    envText: string,
  ): string | null {
    const hostnamePath = (hostnamePaths?.[this.cachedHostname] ?? '').trim();
    const customEnv = parseEnvironmentVariables(envText || '');
    return resolveConfiguredCliPath(hostnamePath)
      ?? resolveConfiguredCliPath(legacyPath.trim())
      ?? findCliBinaryPath('hermes', customEnv.PATH);
  }

  reset(): void {
    this.lastCliPath = '';
    this.lastHostnamePath = '';
    this.lastEnvText = '';
    this.resolvedPath = null;
    this.hasResolved = false;
  }
}
