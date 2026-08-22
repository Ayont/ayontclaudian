import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export const DSH_PROVIDER_ID = 'dsh';

/** Settings persisted for the DeepSeek Harness (
`dsh`) provider. */
export interface PersistedDshProviderSettings {
  /** Explicit path to the `dsh` binary (overrides PATH discovery). */
  cliPath: string;
  /** Hostname-keyed CLI paths, so a synced vault can target per-machine binaries. */
  cliPathsByHost: HostnameCliPaths;
  /** Whether the provider is selectable / enabled. */
  enabled: boolean;
  /** Extra environment variables (newline KEY=VALUE list) for the spawned CLI. */
  environmentVariables: string;
  /** Optional alternate DSH_HOME (`~/.dsh` by default); passed through as env. */
  dshHome: string;
}

export const DEFAULT_DSH_PROVIDER_SETTINGS: Readonly<PersistedDshProviderSettings> = Object.freeze({
  cliPath: '',
  cliPathsByHost: {},
  enabled: false,
  environmentVariables: '',
  dshHome: '',
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

/** Read normalized dsh settings from the global settings record. */
export function getDshProviderSettings(
  settings: Record<string, unknown>,
): PersistedDshProviderSettings {
  const config = getProviderConfig(settings, DSH_PROVIDER_ID);
  return {
    cliPath: asString(config.cliPath, DEFAULT_DSH_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabled: config.enabled === true,
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_DSH_PROVIDER_SETTINGS.environmentVariables,
    ),
    dshHome: asString(config.dshHome, DEFAULT_DSH_PROVIDER_SETTINGS.dshHome).trim(),
  };
}

/** Merge a partial update into the persisted dsh settings. */
export function updateDshProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedDshProviderSettings>,
): PersistedDshProviderSettings {
  const current = getDshProviderSettings(settings);
  const next: PersistedDshProviderSettings = {
    ...current,
    ...updates,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : current.cliPathsByHost,
  };
  setProviderConfig(settings, DSH_PROVIDER_ID, { ...next });
  return next;
}

/** Best CLI path hint from settings for the current host (no PATH fallback). */
export function getConfiguredDshCliPath(settings: PersistedDshProviderSettings): string {
  const hostKey = getHostnameKey();
  const hostPath = settings.cliPathsByHost[hostKey];
  if (typeof hostPath === 'string' && hostPath.trim()) {
    return hostPath.trim();
  }
  return settings.cliPath.trim();
}

/**
 * Side effects when the active model changes. The headless profile has no
 * model flag (verified against 
`dsh --profile headless --help`; model choice
 * follows agent-default-model in ~/.dsh/settings.yaml), so this is inert but
 * present to keep the chatUIConfig contract uniform with the other providers.
 */
export function applyDshModelDefaults(
  _model: string,
  _settings: Record<string, unknown>,
): void {}
