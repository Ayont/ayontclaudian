import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getAntigravityProviderSettings,
  getConfiguredAntigravityCliPath,
  type PersistedAntigravityProviderSettings,
} from '../settings';

/** The Antigravity CLI binary name (Go binary `agy`, not `antigravity`). */
export const ANTIGRAVITY_CLI_BINARY = 'agy';

/**
 * Locates the `agy` executable.
 *
 * Resolution order:
 *   1. Host-keyed / explicit `cliPath` from settings (if the file exists).
 *   2. `agy` discovered on PATH (PATH enhanced with common bin dirs).
 *
 * Returns the absolute path, or `null` when the binary cannot be found.
 */
export class AntigravityCliResolver {
  private hasCachedResult = false;
  private cachedConfiguredPath = '';
  private cachedAdditionalPath: string | undefined;
  private cachedResult: string | null = null;

  resolve(settings: PersistedAntigravityProviderSettings, additionalPath?: string): string | null {
    // PATH scans and npmrc reads are expensive, and the status bar re-resolves
    // on every streaming usage chunk, so memoize on the exact inputs — misses
    // included, otherwise a missing CLI would rescan forever.
    const configuredPath = getConfiguredAntigravityCliPath(settings);
    if (
      this.hasCachedResult
      && configuredPath === this.cachedConfiguredPath
      && additionalPath === this.cachedAdditionalPath
    ) {
      return this.cachedResult;
    }

    const resolved = resolveConfiguredCliPath(configuredPath)
      ?? findCliBinaryPath(ANTIGRAVITY_CLI_BINARY, additionalPath);

    this.hasCachedResult = true;
    this.cachedConfiguredPath = configuredPath;
    this.cachedAdditionalPath = additionalPath;
    this.cachedResult = resolved;
    return resolved;
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getAntigravityProviderSettings(settings), additionalPath);
  }

  /** True when an `agy` binary is reachable from the given settings. */
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
