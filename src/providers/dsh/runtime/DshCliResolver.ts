import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getConfiguredDshCliPath,
  getDshProviderSettings,
  type PersistedDshProviderSettings,
} from '../settings';

/** Primary dsh binary name. */
export const DSH_CLI_BINARY = 'dsh';

/**
 * Locates the `dsh` executable (@deepseek-ai/dsh).
 *
 * Resolution order:
 *   1. Host-keyed / explicit `cliPath` from settings (if the file exists).
 *   2. `dsh` discovered on PATH (PATH enhanced with common bin dirs).
 *   3. The newest dsh that `npx @deepseek-ai/dsh` materialized into the npm
 *      cache (a `<hash>/node_modules/.bin/dsh` entry under `~/.npm/_npx/`) —
 *      Obsidian GUI apps get a minimal PATH, and many users only ever run dsh
 *      through npx.
 *
 * Returns the absolute path, or `null` when the binary cannot be found.
 */

/**
 * Newest npx-cached dsh launcher under `<home>/.npm/_npx/<hash>/node_modules/.bin/`,
 * or null. statSync follows symlinks, so a broken cache entry is skipped rather
 * than returned as an executable.
 */
export function findNpxCachedDshBinary(homeDir?: string): string | null {
  const home = homeDir ?? os.homedir();
  const npxRoot = path.join(home, '.npm', '_npx');
  let hashes: string[];
  try {
    hashes = fs.readdirSync(npxRoot);
  } catch {
    return null;
  }

  let best: string | null = null;
  let bestMtimeMs = 0;
  for (const hash of hashes) {
    const candidate = path.join(npxRoot, hash, 'node_modules', '.bin', DSH_CLI_BINARY);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.mtimeMs <= bestMtimeMs) {
        continue;
      }
      bestMtimeMs = stat.mtimeMs;
      best = candidate;
    } catch {
      // Missing entry or dangling symlink — skip.
    }
  }
  return best;
}
export class DshCliResolver {
  private hasCachedResult = false;
  private cachedConfiguredPath = '';
  private cachedAdditionalPath: string | undefined;
  private cachedResult: string | null = null;

  /** Optional alternate home for the npx-cache scan (tests / portable setups). */
  constructor(private readonly npxScanHome?: string) {}

  resolve(settings: PersistedDshProviderSettings, additionalPath?: string): string | null {
    // PATH scans and npmrc reads are expensive, and the status bar re-resolves
    // on every streaming usage chunk, so memoize on the exact inputs — misses
    // included, otherwise a missing CLI would rescan forever.
    const configuredPath = getConfiguredDshCliPath(settings);
    if (
      this.hasCachedResult
      && configuredPath === this.cachedConfiguredPath
      && additionalPath === this.cachedAdditionalPath
    ) {
      return this.cachedResult;
    }

    const resolved = resolveConfiguredCliPath(configuredPath)
      ?? findCliBinaryPath(DSH_CLI_BINARY, additionalPath)
      ?? findNpxCachedDshBinary(this.npxScanHome);

    this.hasCachedResult = true;
    this.cachedConfiguredPath = configuredPath;
    this.cachedAdditionalPath = additionalPath;
    this.cachedResult = resolved;
    return resolved;
  }

  /** Convenience overload resolving straight from the global settings record. */
  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getDshProviderSettings(settings), additionalPath);
  }

  /** True when a `dsh` binary is reachable from the given settings. */
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
