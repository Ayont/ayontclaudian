import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getResolvedZcodeCliPath,
  getZcodeProviderSettings,
  type PersistedZcodeProviderSettings,
} from '../settings';

export const ZCODE_CLI_BINARY = 'zcode';

/** Known application paths on macOS. */
const MAC_ZCODE_APP_CLI = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';

export class ZcodeCliResolver {
  private hasCachedResult = false;
  private cachedConfiguredPath = '';
  private cachedAdditionalPath: string | undefined;
  private cachedResult: string | null = null;

  resolve(settings: PersistedZcodeProviderSettings, additionalPath?: string): string | null {
    const configuredPath = getResolvedZcodeCliPath(settings);
    if (
      this.hasCachedResult &&
      configuredPath === this.cachedConfiguredPath &&
      additionalPath === this.cachedAdditionalPath
    ) {
      return this.cachedResult;
    }

    let resolved =
      resolveConfiguredCliPath(configuredPath) ??
      findCliBinaryPath(ZCODE_CLI_BINARY, additionalPath);

    if (!resolved) {
      const candidates = [
        path.join(os.homedir(), '.local', 'bin', 'zcode'),
        '/usr/local/bin/zcode',
        '/opt/homebrew/bin/zcode',
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          try {
            fs.accessSync(cand, fs.constants.X_OK);
            resolved = cand;
            break;
          } catch {
            // Not executable or accessible
          }
        }
      }
    }

    if (!resolved && fs.existsSync(MAC_ZCODE_APP_CLI)) {
      resolved = MAC_ZCODE_APP_CLI;
    }

    this.hasCachedResult = true;
    this.cachedConfiguredPath = configuredPath;
    this.cachedAdditionalPath = additionalPath;
    this.cachedResult = resolved;
    return resolved;
  }

  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getZcodeProviderSettings(settings), additionalPath);
  }

  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  reset(): void {
    this.clearCache();
  }

  clearCache(): void {
    this.hasCachedResult = false;
    this.cachedConfiguredPath = '';
    this.cachedAdditionalPath = undefined;
    this.cachedResult = null;
  }
}
