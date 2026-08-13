import * as fs from 'node:fs';
import * as path from 'node:path';

import { findCliBinaryPath, resolveConfiguredCliPath } from '../../../utils/cliBinaryLocator';
import {
  getClineProviderSettings,
  getConfiguredClineCliPath,
  type PersistedClineProviderSettings,
} from '../settings';

export const CLINE_BINARY = 'cline';

/** Prefer the compiled Bun binary next to the Node wrapper (`bin/.cline`). */
export function resolveClineNativeBinary(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return trimmed;
  }
  const sibling = path.join(path.dirname(trimmed), '.cline');
  try {
    if (fs.existsSync(sibling) && fs.statSync(sibling).isFile()) {
      return sibling;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

export class ClineCliResolver {
  resolve(settings: PersistedClineProviderSettings, additionalPath?: string): string | null {
    const configured = resolveConfiguredCliPath(getConfiguredClineCliPath(settings));
    if (configured) {
      return resolveClineNativeBinary(configured);
    }
    const fromPath = findCliBinaryPath(CLINE_BINARY, additionalPath);
    return fromPath ? resolveClineNativeBinary(fromPath) : null;
  }

  resolveFromSettings(settings: Record<string, unknown>, additionalPath?: string): string | null {
    return this.resolve(getClineProviderSettings(settings), additionalPath);
  }

  isAvailable(settings: Record<string, unknown>, additionalPath?: string): boolean {
    return this.resolveFromSettings(settings, additionalPath) !== null;
  }

  reset(): void {}
}
