import { findCliBinaryPath } from '../../utils/cliBinaryLocator';
import { ProviderWorkspaceRegistry } from '../providers/ProviderWorkspaceRegistry';
import { getCliInstallSpec } from './cliInstallCatalog';

/**
 * Whether a provider's CLI binary is resolvable on PATH (the signal used to
 * gray out a provider until its CLI is installed). Returns false for unknown
 * providers. `additionalPath` lets a configured cliPath dir be considered too.
 */
export function isCliInstalled(providerId: string, additionalPath?: string): boolean {
  const spec = getCliInstallSpec(providerId);
  if (!spec) {
    return false;
  }
  const candidates = [spec.binary, ...(spec.binaryAliases ?? [])];
  return candidates.some((binary) => findCliBinaryPath(binary, additionalPath) !== null);
}

/**
 * Resolve the absolute path to a provider's CLI, preferring the provider's own
 * resolver (which honors explicit `cliPath` / host-keyed paths) and falling back
 * to PATH discovery via the install catalog.
 */
export function resolveProviderCliPath(
  providerId: string,
  settings: Record<string, unknown>,
): string | null {
  const resolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
  if (resolver) {
    return resolver.resolveFromSettings(settings);
  }

  const spec = getCliInstallSpec(providerId);
  if (!spec) {
    return null;
  }

  const candidates = [spec.binary, ...(spec.binaryAliases ?? [])];
  for (const binary of candidates) {
    const found = findCliBinaryPath(binary);
    if (found) {
      return found;
    }
  }

  return null;
}

/** True when a provider's CLI can be resolved from settings or PATH. */
export function isProviderCliInstalled(
  providerId: string,
  settings: Record<string, unknown>,
): boolean {
  return resolveProviderCliPath(providerId, settings) !== null;
}
