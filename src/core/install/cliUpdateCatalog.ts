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

export function getCliUpdateSpec(providerId: string): CliUpdateSpec | null {
  const install = CLI_INSTALL_CATALOG[providerId];
  if (!install) {
    return null;
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
): string | null {
  const native = NATIVE_UPDATE_COMMANDS[providerId];
  if (native) {
    return native;
  }
  const spec = getCliUpdateSpec(providerId);
  if (spec?.npmPackage) {
    return `npm install -g ${spec.npmPackage}@latest`;
  }
  return getPreferredInstallCommand(providerId, platform)?.command ?? null;
}
