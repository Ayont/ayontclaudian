import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getClineProviderSettings,
  getConfiguredClineCliPath,
  type PersistedClineProviderSettings,
} from '../settings';

export const CLINE_BINARY = 'cline';

/**
 * Keep the Node wrapper (`bin/cline`). Spawning the sibling Bun binary
 * (`.cline`) from Electron dies with a null exit code.
 */
export function resolveClineNativeBinary(command: string): string {
  return command.trim();
}

export class ClineCliResolver {
  resolve(settings: PersistedClineProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredClineCliPath(settings));
    if (configured) {
      return resolveClineNativeBinary(configured);
    }
    const fromPath = findCliBinaryPath(CLINE_BINARY, additionalPath);
    return fromPath ? resolveClineNativeBinary(fromPath) : null;
  }

  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getClineProviderSettings(settings), additionalPath);
  }

  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  reset(): void {}
}
