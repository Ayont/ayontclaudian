import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';

export const FREEBUFF_PROVIDER_ID = 'freebuff';

/**
 * Settings persisted for the Freebuff provider.
 *
 * There is no CLI spawn: turns run as threads inside the Freebuff desktop app
 * and reach the plugin over its loopback HTTP API, so the tunables are the
 * model plus an optional explicit orchestrator port (auto-discovered by
 * default) — not binary paths or env vars.
 */
export interface PersistedFreebuffProviderSettings {
  /** Whether the provider is selectable / enabled. */
  enabled: boolean;
  /** Harness model id (verified catalog ids only). */
  model: string;
  /** Explicit orchestrator port; empty = auto-discover via pgrep/lsof. */
  orchestratorPort: string;
  /** Project directory the desktop app should use; empty = vault path. */
  projectPath: string;
}

export const DEFAULT_FREEBUFF_PROVIDER_SETTINGS: Readonly<PersistedFreebuffProviderSettings> = Object.freeze({
  enabled: false,
  model: 'deepseek/deepseek-v4-flash',
  orchestratorPort: '',
  projectPath: '',
});

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Read normalized freebuff settings from the global settings record. */
export function getFreebuffProviderSettings(
  settings: Record<string, unknown>,
): PersistedFreebuffProviderSettings {
  const config = getProviderConfig(settings, FREEBUFF_PROVIDER_ID);
  return {
    enabled: config.enabled === true,
    model: asString(config.model, DEFAULT_FREEBUFF_PROVIDER_SETTINGS.model).trim(),
    orchestratorPort: asString(config.orchestratorPort, '').trim(),
    projectPath: asString(config.projectPath, '').trim(),
  };
}

/** Merge a partial update into the persisted freebuff settings. */
export function updateFreebuffProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedFreebuffProviderSettings>,
): PersistedFreebuffProviderSettings {
  const current = getFreebuffProviderSettings(settings);
  const next: PersistedFreebuffProviderSettings = {
    ...current,
    ...updates,
  };
  setProviderConfig(settings, FREEBUFF_PROVIDER_ID, { ...next });
  return next;
}