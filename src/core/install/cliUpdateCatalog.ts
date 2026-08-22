import { existsSync, realpathSync } from 'node:fs';

import {
  CLI_INSTALL_CATALOG,
  getPreferredInstallCommand,
} from './cliInstallCatalog';

export interface CliUpdateSpec {
  providerId: string;
  displayName: string;
  versionArgs: string[];
  npmPackage?: string;
  pypiPackage?: string;
  updateCommand?: string;
}

const NPM_PACKAGES: Record<string, string> = {
  claude: '@anthropic-ai/claude-code',
  cline: 'cline',
  codex: '@openai/codex',
  opencode: 'opencode-ai',
};

const PYPI_PACKAGES: Record<string, string> = {
  vibe: 'mistral-vibe',
  kimi: 'kimi-cli',
};

/** Native self-update commands that beat re-running the installer script. */
const NATIVE_UPDATE_COMMANDS: Record<string, string> = {
  antigravity: 'agy update',
  vibe: 'uv tool upgrade mistral-vibe',
  kimi: 'uv tool upgrade kimi-cli',
};

/** Vendor-managed install dirs whose binary is owned by the CLI's own
 *  installer, not by npm/pip — updating the registry package there would
 *  touch a copy nobody runs (the opencode "update does nothing" bug).
 *  Commands verified against the shipped CLIs (`--help`). */
const STANDALONE_DIR_PATTERNS: Record<string, RegExp> = {
  opencode: /\/\.opencode\//,
  grok: /\/\.grok\//,
  claude: /(\/\.local\/(?:bin\/claude(?:\.exe)?$|share\/claude\/))/,
};
const STANDALONE_UPDATE_COMMANDS: Record<string, string> = {
  opencode: 'opencode upgrade',
  grok: 'grok update',
  claude: 'claude update',
};

/** Returns the CLI's own update command when the resolved binary lives in a
 *  vendor-managed dir; symlinks are resolved so homebrew-style aliases match. */
export function resolveStandaloneUpdateCommand(
  providerId: string,
  cliPath?: string | null,
): string | null {
  const pattern = STANDALONE_DIR_PATTERNS[providerId];
  const command = STANDALONE_UPDATE_COMMANDS[providerId];
  if (!pattern || !command || !cliPath) {
    return null;
  }
  let resolved = cliPath.replace(/\\/g, '/');
  try {
    if (existsSync(cliPath)) {
      resolved = realpathSync(cliPath).replace(/\\/g, '/');
    }
  } catch {
    // Unresolvable path: fall through and test it as given.
  }
  return pattern.test(resolved) ? command : null;
}

/** Official Kimi Code installer — `kimi upgrade` can no-op with exit 0. */
export const KIMI_CODE_UPDATE_COMMAND_UNIX =
  'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash';
export const KIMI_CODE_UPDATE_COMMAND_WIN =
  'powershell -NoProfile -Command "irm https://code.kimi.com/kimi-code/install.ps1 | iex"';

export function isKimiCodeInstall(cliPath: string | null | undefined): boolean {
  if (!cliPath) return false;
  const normalized = cliPath.replace(/\\/g, '/').toLowerCase();
  if (normalized.includes('/.kimi-code/')) return true;
  if (normalized.includes('kimi-cli')) return false;
  return /(?:^|\/)kimi$/.test(normalized);
}

export function getCliUpdateSpec(
  providerId: string,
  cliPath?: string | null,
): CliUpdateSpec | null {
  const install = CLI_INSTALL_CATALOG[providerId];
  if (!install) {
    return null;
  }
  if (providerId === 'kimi' && isKimiCodeInstall(cliPath)) {
    return {
      providerId,
      displayName: install.displayName,
      versionArgs: ['--version'],
      npmPackage: '@moonshot-ai/kimi-code',
    };
  }
  return {
    providerId,
    displayName: install.displayName,
    versionArgs: ['--version'],
    npmPackage: NPM_PACKAGES[providerId],
    pypiPackage: PYPI_PACKAGES[providerId],
  };
}

export function getPreferredUpdateCommand(
  providerId: string,
  platform: NodeJS.Platform,
  cliPath?: string | null,
): string | null {
  if (providerId === 'kimi' && isKimiCodeInstall(cliPath)) {
    return platform === 'win32'
      ? KIMI_CODE_UPDATE_COMMAND_WIN
      : KIMI_CODE_UPDATE_COMMAND_UNIX;
  }
  const standalone = resolveStandaloneUpdateCommand(providerId, cliPath);
  if (standalone) {
    return standalone;
  }
  const native = NATIVE_UPDATE_COMMANDS[providerId];
  if (native) {
    return native;
  }
  const spec = getCliUpdateSpec(providerId, cliPath);
  if (spec?.npmPackage) {
    return `npm install -g ${spec.npmPackage}@latest`;
  }
  return getPreferredInstallCommand(providerId, platform)?.command ?? null;
}
