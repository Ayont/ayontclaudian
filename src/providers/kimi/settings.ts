import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export const KIMI_PROVIDER_ID = 'kimi';

/** Agent presets exposed by `kimi-cli --agent`. */
export type KimiAgent = 'default' | 'okabe';

/** Permission posture mapped onto `--yolo` / `--plan`. */
export type KimiPermissionMode = 'normal' | 'yolo' | 'plan';

/** Settings persisted for the Kimi provider. */
export interface PersistedKimiProviderSettings {
  /** Explicit path to the `kimi-cli` binary (overrides PATH discovery). */
  cliPath: string;
  /** Hostname-keyed CLI paths, so a synced vault can target per-machine binaries. */
  cliPathsByHost: HostnameCliPaths;
  /** Whether the provider is selectable / enabled. */
  enabled: boolean;
  /** Extra environment variables (newline `KEY=VALUE` list) for the spawned CLI. */
  environmentVariables: string;
  /** Newline-separated extra model ids merged into the model dropdown. */
  customModels: string;
  /** Default `--thinking` (true) vs `--no-thinking` (false) for new turns. */
  thinkingDefault: boolean;
  /** Builtin agent preset passed via `--agent`. */
  agent: KimiAgent;
  /** Optional custom agent spec file passed via `--agent-file`. */
  agentFile: string;
  /** Optional MCP servers config file passed via `--mcp-config-file`. */
  mcpConfigFile: string;
  /** Permission posture mapped onto `--yolo` / `--plan`. */
  permissionMode: KimiPermissionMode;
  /** Optional Moonshot API key stored locally and synced into the provider env as `MOONSHOT_API_KEY`. */
  apiKey: string;
  /** Use `kimi acp` (Agent Client Protocol) for persistent interactive sessions instead of one-shot `-p` mode. */
  useAcp: boolean;
}

export const DEFAULT_KIMI_PROVIDER_SETTINGS: Readonly<PersistedKimiProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentVariables: '',
  customModels: '',
  thinkingDefault: true,
  agent: 'default',
  agentFile: '',
  mcpConfigFile: '',
  permissionMode: 'normal',
  apiKey: '',
  useAcp: false,
});

function normalizeHostnameCliPaths(value: unknown): HostnameCliPaths {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const result: HostnameCliPaths = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim()) {
      result[key] = entry.trim();
    }
  }
  return result;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeAgent(value: unknown): KimiAgent {
  return value === 'okabe' ? 'okabe' : 'default';
}

function normalizePermissionMode(value: unknown): KimiPermissionMode {
  if (value === 'yolo' || value === 'plan') {
    return value;
  }
  return 'normal';
}

/** Read normalized Kimi settings from the global settings record. */
export function getKimiProviderSettings(
  settings: Record<string, unknown>,
): PersistedKimiProviderSettings {
  const config = getProviderConfig(settings, KIMI_PROVIDER_ID);
  return {
    cliPath: asString(config.cliPath, DEFAULT_KIMI_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabled: config.enabled === true,
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_KIMI_PROVIDER_SETTINGS.environmentVariables,
    ),
    customModels: asString(config.customModels, DEFAULT_KIMI_PROVIDER_SETTINGS.customModels),
    thinkingDefault: config.thinkingDefault !== false,
    agent: normalizeAgent(config.agent),
    agentFile: asString(config.agentFile, DEFAULT_KIMI_PROVIDER_SETTINGS.agentFile).trim(),
    mcpConfigFile: asString(config.mcpConfigFile, DEFAULT_KIMI_PROVIDER_SETTINGS.mcpConfigFile).trim(),
    permissionMode: normalizePermissionMode(config.permissionMode),
    apiKey: asString(config.apiKey, DEFAULT_KIMI_PROVIDER_SETTINGS.apiKey),
    useAcp: config.useAcp === true,
  };
}

/** Merge a partial update into the persisted Kimi settings. */
export function updateKimiProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedKimiProviderSettings>,
): PersistedKimiProviderSettings {
  const current = getKimiProviderSettings(settings);
  const next: PersistedKimiProviderSettings = {
    ...current,
    ...updates,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : current.cliPathsByHost,
    agent: updates.agent ? normalizeAgent(updates.agent) : current.agent,
    permissionMode: updates.permissionMode
      ? normalizePermissionMode(updates.permissionMode)
      : current.permissionMode,
    apiKey: updates.apiKey !== undefined ? updates.apiKey : current.apiKey,
    useAcp: updates.useAcp !== undefined ? updates.useAcp === true : current.useAcp,
  };
  setProviderConfig(settings, KIMI_PROVIDER_ID, { ...next });
  return next;
}

/** Best CLI path hint from settings for the current host (no PATH fallback). */
export function getConfiguredKimiCliPath(settings: PersistedKimiProviderSettings): string {
  const hostKey = getHostnameKey();
  const hostPath = settings.cliPathsByHost[hostKey];
  if (typeof hostPath === 'string' && hostPath.trim()) {
    return hostPath.trim();
  }
  return settings.cliPath.trim();
}

/**
 * Side effects when the active model changes. Kimi has no per-model setting
 * dependencies (unlike codex's reasoning-summary gating), so this is inert but
 * present to keep the chatUIConfig contract uniform with the other providers.
 */
export function applyKimiModelDefaults(
  _model: string,
  _settings: Record<string, unknown>,
): void {}
