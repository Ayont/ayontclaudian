import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getConfiguredVibeCliPath,
  getVibeProviderSettings,
  type PersistedVibeProviderSettings,
} from '../settings';

/** Primary Vibe CLI binary name. */
export const VIBE_CLI_BINARY = 'vibe';

/** Fallback binary name (legacy / alternate install). */
export const VIBE_CLI_BINARY_FALLBACK = 'vibe-cli';

/**
 * Locates the `vibe` executable.
 *
 * Resolution order:
 *   1. Host-keyed / explicit `cliPath` from settings (if the file exists).
 *   2. `vibe` discovered on PATH (PATH enhanced with common bin dirs).
 *   3. `vibe-cli` discovered on PATH (legacy / alternate binary name).
 *
 * Returns the absolute path, or `null` when the binary cannot be found.
 */
export class VibeCliResolver {
  private hasCachedResult = false;
  private cachedConfiguredPath = '';
  private cachedAdditionalPath: string | undefined;
  private cachedResult: string | null = null;

  resolve(settings: PersistedVibeProviderSettings, additionalPath?: string): string | null {
    // PATH scans and npmrc reads are expensive, and the status bar re-resolves
    // on every streaming usage chunk, so memoize on the exact inputs — misses
    // included, otherwise a missing CLI would rescan forever.
    const configuredPath = getConfiguredVibeCliPath(settings);
    if (
      this.hasCachedResult
      && configuredPath === this.cachedConfiguredPath
      && additionalPath === this.cachedAdditionalPath
    ) {
      return this.cachedResult;
    }

    const resolved = resolveConfiguredCliPath(configuredPath)
      ?? findCliBinaryPath(VIBE_CLI_BINARY, additionalPath)
      ?? findCliBinaryPath(VIBE_CLI_BINARY_FALLBACK, additionalPath);

    this.hasCachedResult = true;
    this.cachedConfiguredPath = configuredPath;
    this.cachedAdditionalPath = additionalPath;
    this.cachedResult = resolved;
    return resolved;
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getVibeProviderSettings(settings), additionalPath);
  }

  /** True when a `vibe` binary is reachable from the given settings. */
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
