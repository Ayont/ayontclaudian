import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getClineProviderSettings,
  getConfiguredClineCliPath,
  type PersistedClineProviderSettings,
} from '../settings';

export const CLINE_BINARY = 'cline';

export class ClineCliResolver {
  resolve(settings: PersistedClineProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredClineCliPath(settings));
    if (configured) {
      return configured;
    }
    return findCliBinaryPath(CLINE_BINARY, additionalPath);
  }

  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getClineProviderSettings(settings), additionalPath);
  }

  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  reset(): void {}
}
