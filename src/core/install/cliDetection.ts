import { findCliBinaryPath } from '../../utils/cliBinaryLocator';
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
