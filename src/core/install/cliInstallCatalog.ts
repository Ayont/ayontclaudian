/**
 * Per-provider CLI install metadata: how to install each coding-agent CLI, the
 * binary used to detect whether it is already installed, and the official docs
 * link. Drives the "install from inside Claudian" flow and the grayed-out state
 * shown when a provider's CLI is missing.
 *
 * `command` is a shell one-liner run by the installer; when it is empty only
 * `docsUrl` is offered (the official command is not safely automatable, so we
 * link the docs instead of guessing). Commands are matched per-platform with a
 * `default` fallback.
 */

export interface CliInstallMethod {
  /** Short label for the method, e.g. "uv tool", "npm", "Installer-Skript". */
  label: string;
  /** Shell command to run, or '' when only the docs link should be offered. */
  command: string;
}

export type InstallPlatform = 'darwin' | 'win32' | 'linux';

export interface CliInstallSpec {
  /** Provider id (matches ProviderId). */
  id: string;
  /** Human-facing CLI name. */
  displayName: string;
  /** Binary name to detect via PATH (findCliBinaryPath). */
  binary: string;
  /**
   * Alternate binary names to also probe during detection (e.g. a CLI that
   * installs under both a modern and a legacy command name). The primary
   * `binary` is checked first, then these in order.
   */
  binaryAliases?: string[];
  /** Official install / setup documentation. */
  docsUrl: string;
  /** Per-platform install methods (first is preferred). `default` is the fallback. */
  methods: Partial<Record<InstallPlatform | 'default', CliInstallMethod[]>>;
}

const NPM = (pkg: string): CliInstallMethod => ({ label: 'npm', command: `npm install -g ${pkg}` });

export const CLI_INSTALL_CATALOG: Record<string, CliInstallSpec> = {
  // Mistral Vibe — uv-based Python tool; mac/Linux also have an installer script.
  vibe: {
    id: 'vibe',
    displayName: 'Vibe (Mistral)',
    binary: 'vibe',
    docsUrl: 'https://docs.mistral.ai/vibe/code/cli/install-setup',
    methods: {
      darwin: [
        { label: 'Installer-Skript', command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash' },
        { label: 'uv tool', command: 'uv tool install mistral-vibe' },
      ],
      linux: [
        { label: 'Installer-Skript', command: 'curl -LsSf https://mistral.ai/vibe/install.sh | bash' },
        { label: 'uv tool', command: 'uv tool install mistral-vibe' },
      ],
      win32: [{ label: 'uv tool', command: 'uv tool install mistral-vibe' }],
      default: [{ label: 'uv tool', command: 'uv tool install mistral-vibe' }],
    },
  },

  // xAI Grok CLI — installer script (mac/Linux) / PowerShell (Windows).
  grok: {
    id: 'grok',
    displayName: 'Grok (xAI)',
    binary: 'grok',
    docsUrl: 'https://docs.x.ai/build/overview',
    methods: {
      darwin: [{ label: 'Installer-Skript', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }],
      linux: [{ label: 'Installer-Skript', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }],
      win32: [{ label: 'PowerShell', command: 'powershell -NoProfile -Command "irm https://x.ai/cli/install.ps1 | iex"' }],
      default: [{ label: 'Installer-Skript', command: 'curl -fsSL https://x.ai/cli/install.sh | bash' }],
    },
  },

  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    binary: 'claude',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    methods: { default: [NPM('@anthropic-ai/claude-code')] },
  },

  codex: {
    id: 'codex',
    displayName: 'Codex',
    binary: 'codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    methods: { default: [NPM('@openai/codex')] },
  },

  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    binary: 'opencode',
    docsUrl: 'https://opencode.ai/docs/',
    methods: {
      darwin: [
        { label: 'Installer-Skript', command: 'curl -fsSL https://opencode.ai/install | bash' },
        NPM('opencode-ai'),
      ],
      linux: [
        { label: 'Installer-Skript', command: 'curl -fsSL https://opencode.ai/install | bash' },
        NPM('opencode-ai'),
      ],
      win32: [NPM('opencode-ai')],
      default: [NPM('opencode-ai')],
    },
  },

  kimi: {
    id: 'kimi',
    displayName: 'Kimi CLI',
    // Modern kimi-code / npm builds ship `kimi`; legacy uv installs provided
    // `kimi-cli` (+ `kimi-legacy`). Probe all three so an existing install is found.
    binary: 'kimi',
    binaryAliases: ['kimi-cli', 'kimi-legacy'],
    docsUrl: 'https://github.com/MoonshotAI/kimi-cli',
    methods: { default: [{ label: 'uv tool', command: 'uv tool install kimi-cli' }] },
  },

  // Auth/install for these is account- or IDE-specific; link the docs rather
  // than guess an install command that could fail or install the wrong package.
  antigravity: {
    id: 'antigravity',
    displayName: 'Antigravity (agy)',
    binary: 'agy',
    docsUrl: 'https://antigravity.google/docs/cli',
    methods: { default: [{ label: 'Docs', command: '' }] },
  },

  pi: {
    id: 'pi',
    displayName: 'Pi',
    binary: 'pi',
    docsUrl: 'https://github.com/parallel-web/pi',
    methods: { default: [{ label: 'Docs', command: '' }] },
  },
};

/** Returns the install spec for a provider id, or null when none is known. */
export function getCliInstallSpec(id: string): CliInstallSpec | null {
  return CLI_INSTALL_CATALOG[id] ?? null;
}

/** Normalizes an arbitrary platform to the catalog's supported set. */
export function normalizeInstallPlatform(platform: NodeJS.Platform): InstallPlatform | 'default' {
  if (platform === 'darwin' || platform === 'win32' || platform === 'linux') {
    return platform;
  }
  return 'default';
}

/**
 * Resolves the install methods to offer for a provider on a platform, falling
 * back to `default`. Returns [] when nothing is known.
 */
export function getInstallMethods(id: string, platform: NodeJS.Platform): CliInstallMethod[] {
  const spec = getCliInstallSpec(id);
  if (!spec) {
    return [];
  }
  const key = normalizeInstallPlatform(platform);
  return spec.methods[key] ?? spec.methods.default ?? [];
}

/** The preferred runnable install command for a provider/platform, or null. */
export function getPreferredInstallCommand(id: string, platform: NodeJS.Platform): CliInstallMethod | null {
  const runnable = getInstallMethods(id, platform).find((method) => method.command.trim().length > 0);
  return runnable ?? null;
}
