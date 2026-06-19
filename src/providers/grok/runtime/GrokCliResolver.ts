import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getConfiguredGrokCliPath,
  getGrokProviderSettings,
  type PersistedGrokProviderSettings,
} from '../settings';

/** Primary Grok CLI binary name. */
export const GROK_CLI_BINARY = 'grok';

/** Fallback binary name (legacy / alternate install). */
export const GROK_CLI_BINARY_FALLBACK = 'grok-cli';

/**
 * Locates the `grok` executable.
 *
 * Resolution order:
 *   1. Host-keyed / explicit `cliPath` from settings (if the file exists).
 *   2. `grok` discovered on PATH (PATH enhanced with common bin dirs).
 *   3. `grok-cli` discovered on PATH (legacy / alternate binary name).
 *
 * Returns the absolute path, or `null` when the binary cannot be found.
 */
export class GrokCliResolver {
  resolve(settings: PersistedGrokProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredGrokCliPath(settings));
    if (configured) {
      return configured;
    }
    return (
      findCliBinaryPath(GROK_CLI_BINARY, additionalPath)
      ?? findCliBinaryPath(GROK_CLI_BINARY_FALLBACK, additionalPath)
    );
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getGrokProviderSettings(settings), additionalPath);
  }

  /** True when a `grok` binary is reachable from the given settings. */
  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  /**
   * Satisfies the `ProviderCliResolver` contract. This resolver holds no
   * cached state, so resetting is a no-op.
   */
  reset(): void {}
}
