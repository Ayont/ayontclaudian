import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export const VIBE_PROVIDER_ID = 'vibe';

/** Agent presets exposed by `vibe --agent`. */
export type VibeAgent = 'default' | 'okabe';

/** Permission posture mapped onto `--yolo` / `--plan`. */
export type VibePermissionMode = 'normal' | 'yolo' | 'plan';

/** Settings persisted for the Vibe provider. */
export interface PersistedVibeProviderSettings {
  /** Explicit path to the `vibe` binary (overrides PATH discovery). */
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
  agent: VibeAgent;
  /** Optional custom agent spec file passed via `--agent-file`. */
  agentFile: string;
  /** Optional MCP servers config file passed via `--mcp-config-file`. */
  mcpConfigFile: string;
  /** Permission posture mapped onto `--yolo` / `--plan`. */
  permissionMode: VibePermissionMode;
}

export const DEFAULT_VIBE_PROVIDER_SETTINGS: Readonly<PersistedVibeProviderSettings> = Object.freeze({
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

function normalizeAgent(value: unknown): VibeAgent {
  return value === 'okabe' ? 'okabe' : 'default';
}

function normalizePermissionMode(value: unknown): VibePermissionMode {
  if (value === 'yolo' || value === 'plan') {
    return value;
  }
  return 'normal';
}

/** Read normalized Vibe settings from the global settings record. */
export function getVibeProviderSettings(
  settings: Record<string, unknown>,
): PersistedVibeProviderSettings {
  const config = getProviderConfig(settings, VIBE_PROVIDER_ID);
  return {
    cliPath: asString(config.cliPath, DEFAULT_VIBE_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabled: config.enabled === true,
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_VIBE_PROVIDER_SETTINGS.environmentVariables,
    ),
    customModels: asString(config.customModels, DEFAULT_VIBE_PROVIDER_SETTINGS.customModels),
    thinkingDefault: config.thinkingDefault !== false,
    agent: normalizeAgent(config.agent),
    agentFile: asString(config.agentFile, DEFAULT_VIBE_PROVIDER_SETTINGS.agentFile).trim(),
    mcpConfigFile: asString(config.mcpConfigFile, DEFAULT_VIBE_PROVIDER_SETTINGS.mcpConfigFile).trim(),
    permissionMode: normalizePermissionMode(config.permissionMode),
  };
}

/** Merge a partial update into the persisted Vibe settings. */
export function updateVibeProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedVibeProviderSettings>,
): PersistedVibeProviderSettings {
  const current = getVibeProviderSettings(settings);
  const next: PersistedVibeProviderSettings = {
    ...current,
    ...updates,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : current.cliPathsByHost,
    agent: updates.agent ? normalizeAgent(updates.agent) : current.agent,
    permissionMode: updates.permissionMode
      ? normalizePermissionMode(updates.permissionMode)
      : current.permissionMode,
  };
  setProviderConfig(settings, VIBE_PROVIDER_ID, { ...next });
  return next;
}

/** Best CLI path hint from settings for the current host (no PATH fallback). */
export function getConfiguredVibeCliPath(settings: PersistedVibeProviderSettings): string {
  const hostKey = getHostnameKey();
  const hostPath = settings.cliPathsByHost[hostKey];
  if (typeof hostPath === 'string' && hostPath.trim()) {
    return hostPath.trim();
  }
  return settings.cliPath.trim();
}

/**
 * Side effects when the active model changes. Vibe has no per-model setting
 * dependencies (unlike codex's reasoning-summary gating), so this is inert but
 * present to keep the chatUIConfig contract uniform with the other providers.
 */
export function applyVibeModelDefaults(
  _model: string,
  _settings: Record<string, unknown>,
): void {}
