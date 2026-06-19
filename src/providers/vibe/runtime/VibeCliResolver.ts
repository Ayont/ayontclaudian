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
  resolve(settings: PersistedVibeProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredVibeCliPath(settings));
    if (configured) {
      return configured;
    }
    return (
      findCliBinaryPath(VIBE_CLI_BINARY, additionalPath)
      ?? findCliBinaryPath(VIBE_CLI_BINARY_FALLBACK, additionalPath)
    );
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getVibeProviderSettings(settings), additionalPath);
  }

  /** True when a `vibe` binary is reachable from the given settings. */
  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  /**
   * Satisfies the `ProviderCliResolver` contract. This resolver holds no
   * cached state, so resetting is a no-op.
   */
  reset(): void {}
}
