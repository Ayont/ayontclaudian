import * as fs from 'fs';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { HostnameCliPaths } from '../../../core/types/settings';
import { getHostnameKey, parseEnvironmentVariables } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { findClaudeCLIPath } from '../cli/findClaudeCLIPath';
import { getClaudeProviderSettings } from '../settings';

export class ClaudeCliResolver {
  private resolvedPath: string | null = null;
  // Tracks "resolved at least once" separately from the value: a miss (null)
  // is a valid cache entry too, otherwise a missing CLI rescans PATH forever.
  private hasResolved = false;
  private lastHostnamePath = '';
  private lastLegacyPath = '';
  private lastEnvText = '';
  private readonly cachedHostname = getHostnameKey();

  /**
   * Resolves CLI path with priority: device-specific -> legacy -> auto-detect.
   * @param settings Full app settings bag
   */
  resolveFromSettings(settings: Record<string, unknown>): string | null {
    const hostnameKey = this.cachedHostname;
    const claudeSettings = getClaudeProviderSettings(settings);

    const hostnamePath = (claudeSettings.cliPathsByHost[hostnameKey] ?? '').trim();
    const normalizedLegacy = claudeSettings.cliPath.trim();
    const normalizedEnv = getRuntimeEnvironmentText(settings, 'claude');

    if (
      this.hasResolved &&
      hostnamePath === this.lastHostnamePath &&
      normalizedLegacy === this.lastLegacyPath &&
      normalizedEnv === this.lastEnvText
    ) {
      return this.resolvedPath;
    }

    this.lastHostnamePath = hostnamePath;
    this.lastLegacyPath = normalizedLegacy;
    this.lastEnvText = normalizedEnv;

    this.resolvedPath = resolveClaudeCliPath(hostnamePath, normalizedLegacy, normalizedEnv);
    this.hasResolved = true;
    return this.resolvedPath;
  }

  resolve(
    hostnamePaths: HostnameCliPaths | undefined,
    legacyPath: string | undefined,
    envText: string,
  ): string | null {
    return this.resolveFromSettings({
      sharedEnvironmentVariables: envText,
      providerConfigs: {
        claude: {
          cliPath: legacyPath ?? '',
          cliPathsByHost: hostnamePaths ?? {},
        },
      },
    });
  }

  reset(): void {
    this.resolvedPath = null;
    this.hasResolved = false;
    this.lastHostnamePath = '';
    this.lastLegacyPath = '';
    this.lastEnvText = '';
  }
}

function resolveConfiguredPath(rawPath: string | undefined): string | null {
  const trimmed = (rawPath ?? '').trim();
  if (!trimmed) return null;
  try {
    const expanded = expandHomePath(trimmed);
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return expanded;
    }
  } catch {
    // Fall through
  }
  return null;
}

export function resolveClaudeCliPath(
  hostnamePath: string | undefined,
  legacyPath: string | undefined,
  envText: string,
): string | null {
  return (
    resolveConfiguredPath(hostnamePath) ??
    resolveConfiguredPath(legacyPath) ??
    findClaudeCLIPath(parseEnvironmentVariables(envText || '').PATH)
  );
}
