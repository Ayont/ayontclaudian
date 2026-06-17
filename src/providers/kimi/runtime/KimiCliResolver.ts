import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getConfiguredKimiCliPath,
  getKimiProviderSettings,
  type PersistedKimiProviderSettings,
} from '../settings';

/** Primary Kimi CLI binary name. */
export const KIMI_CODE_BINARY = 'kimi';

/** Legacy Python/uv Kimi CLI binary names. */
export const KIMI_CLI_BINARY = 'kimi-cli';
export const KIMI_CLI_BINARY_FALLBACK = 'kimi-legacy';

/**
 * Locates the Kimi executable.
 *
 * Resolution order:
 *   1. Host-keyed / explicit `cliPath` from settings (if the file exists).
 *   2. Modern Kimi Code `kimi` discovered on PATH (PATH includes
 *      `~/.kimi-code/bin`, where the official installer puts the authenticated
 *      single-binary CLI).
 *   3. Legacy `kimi-cli` / `kimi-legacy` discovered on PATH.
 *
 * Returns the absolute path, or `null` when the binary cannot be found.
 */
export class KimiCliResolver {
  resolve(settings: PersistedKimiProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredKimiCliPath(settings));
    if (configured) {
      return configured;
    }
    return (
      findCliBinaryPath(KIMI_CODE_BINARY, additionalPath)
      ?? findCliBinaryPath(KIMI_CLI_BINARY, additionalPath)
      ?? findCliBinaryPath(KIMI_CLI_BINARY_FALLBACK, additionalPath)
    );
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getKimiProviderSettings(settings), additionalPath);
  }

  /** True when a `kimi-cli` binary is reachable from the given settings. */
  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  /**
   * Satisfies the `ProviderCliResolver` contract. This resolver holds no
   * cached state, so resetting is a no-op.
   */
  reset(): void {}
}
