import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import {
  type ClineApiProviderId,
  type ClineThinkingLevel,
  isClineApiProvider,
  isClineThinkingLevel,
} from './types/models';

export const CLINE_PROVIDER_ID = 'cline';

export type ClinePermissionMode = 'normal' | 'yolo' | 'plan';

export interface PersistedClineProviderSettings {
  apiProvider: ClineApiProviderId;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  customModels: string;
  enabled: boolean;
  environmentVariables: string;
  permissionMode: ClinePermissionMode;
  thinking: ClineThinkingLevel;
}

export const DEFAULT_CLINE_PROVIDER_SETTINGS: Readonly<PersistedClineProviderSettings> = Object.freeze({
  apiProvider: 'cline-pass',
  cliPath: '',
  cliPathsByHost: {},
  customModels: '',
  enabled: false,
  environmentVariables: '',
  permissionMode: 'yolo',
  thinking: 'high',
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

function normalizePermissionMode(value: unknown): ClinePermissionMode {
  if (value === 'normal' || value === 'yolo' || value === 'plan') {
    return value;
  }
  return DEFAULT_CLINE_PROVIDER_SETTINGS.permissionMode;
}

export function getClineProviderSettings(
  settings: Record<string, unknown>,
): PersistedClineProviderSettings {
  const config = getProviderConfig(settings, CLINE_PROVIDER_ID);
  return {
    apiProvider: isClineApiProvider(config.apiProvider)
      ? config.apiProvider
      : DEFAULT_CLINE_PROVIDER_SETTINGS.apiProvider,
    cliPath: asString(config.cliPath, DEFAULT_CLINE_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    customModels: asString(config.customModels, DEFAULT_CLINE_PROVIDER_SETTINGS.customModels),
    enabled: config.enabled === true,
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_CLINE_PROVIDER_SETTINGS.environmentVariables,
    ),
    permissionMode: normalizePermissionMode(config.permissionMode),
    thinking: isClineThinkingLevel(config.thinking)
      ? config.thinking
      : DEFAULT_CLINE_PROVIDER_SETTINGS.thinking,
  };
}

export function updateClineProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedClineProviderSettings>,
): PersistedClineProviderSettings {
  const current = getClineProviderSettings(settings);
  const next: PersistedClineProviderSettings = {
    ...current,
    ...updates,
    apiProvider: updates.apiProvider && isClineApiProvider(updates.apiProvider)
      ? updates.apiProvider
      : current.apiProvider,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : current.cliPathsByHost,
    permissionMode: updates.permissionMode
      ? normalizePermissionMode(updates.permissionMode)
      : current.permissionMode,
    thinking: updates.thinking && isClineThinkingLevel(updates.thinking)
      ? updates.thinking
      : current.thinking,
  };
  setProviderConfig(settings, CLINE_PROVIDER_ID, { ...next });
  return next;
}

export function getConfiguredClineCliPath(settings: PersistedClineProviderSettings): string {
  const hostKey = getHostnameKey();
  const hostPath = settings.cliPathsByHost[hostKey];
  if (typeof hostPath === 'string' && hostPath.trim()) {
    return hostPath.trim();
  }
  return settings.cliPath.trim();
}

export function applyClineModelDefaults(
  _model: string,
  _settings: Record<string, unknown>,
): void {}
