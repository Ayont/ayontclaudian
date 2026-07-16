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
  private hasCachedResult = false;
  private cachedConfiguredPath = '';
  private cachedAdditionalPath: string | undefined;
  private cachedResult: string | null = null;

  resolve(settings: PersistedGrokProviderSettings, additionalPath?: string): string | null {
    // PATH scans and npmrc reads are expensive, and the status bar re-resolves
    // on every streaming usage chunk, so memoize on the exact inputs — misses
    // included, otherwise a missing CLI would rescan forever.
    const configuredPath = getConfiguredGrokCliPath(settings);
    if (
      this.hasCachedResult
      && configuredPath === this.cachedConfiguredPath
      && additionalPath === this.cachedAdditionalPath
    ) {
      return this.cachedResult;
    }

    const resolved = resolveConfiguredCliPath(configuredPath)
      ?? findCliBinaryPath(GROK_CLI_BINARY, additionalPath)
      ?? findCliBinaryPath(GROK_CLI_BINARY_FALLBACK, additionalPath);

    this.hasCachedResult = true;
    this.cachedConfiguredPath = configuredPath;
    this.cachedAdditionalPath = additionalPath;
    this.cachedResult = resolved;
    return resolved;
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getGrokProviderSettings(settings), additionalPath);
  }

  /** True when a `grok` binary is reachable from the given settings. */
  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  /** Drops the memoized resolution (e.g. after the CLI path setting changed). */
  reset(): void {
    this.hasCachedResult = false;
    this.cachedConfiguredPath = '';
    this.cachedAdditionalPath = undefined;
    this.cachedResult = null;
  }
}
