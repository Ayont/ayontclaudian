import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export const ZCODE_PROVIDER_ID = 'zcode';

export type ZcodeReasoningEffort = 'low' | 'high' | 'max' | 'off';
export type ZcodePermissionMode = 'normal' | 'yolo' | 'plan';
export type ZcodeExecutionMode = 'api' | 'cli';

export interface PersistedZcodeProviderSettings {
  /** Explicit path to the `zcode` binary (overrides PATH discovery). */
  cliPath: string;
  /** Hostname-keyed CLI paths for sync vault portability. */
  cliPathsByHost: HostnameCliPaths;
  /** Whether the provider is enabled. */
  enabled: boolean;
  /** API key for direct Z.ai Anthropic-compatible API. */
  apiKey: string;
  /** Base URL for Z.ai endpoint (default: https://api.z.ai/api/anthropic). */
  baseURL: string;
  /** Execution mode: direct API (recommended) or local CLI. */
  mode: ZcodeExecutionMode;
  /** Extra environment variables (newline KEY=VALUE list). */
  environmentVariables: string;
  /** Newline-separated custom model names. */
  customModels: string;
  /** Default reasoning effort: low, high, max, or off. */
  reasoningEffort: ZcodeReasoningEffort;
  /** Default permission mode: normal, yolo, or plan. */
  permissionMode: ZcodePermissionMode;
}

export const DEFAULT_ZCODE_PROVIDER_SETTINGS: Readonly<PersistedZcodeProviderSettings> = Object.freeze({
  cliPath: 'zcode',
  cliPathsByHost: {},
  enabled: false,
  apiKey: '',
  baseURL: 'https://api.z.ai/api/anthropic',
  mode: 'api',
  environmentVariables: '',
  customModels: '',
  reasoningEffort: 'max',
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

function normalizeReasoningEffort(value: unknown): ZcodeReasoningEffort {
  if (value === 'low' || value === 'high' || value === 'max' || value === 'off') {
    return value;
  }
  return 'max';
}

function normalizePermissionMode(value: unknown): ZcodePermissionMode {
  if (value === 'yolo' || value === 'plan') {
    return value;
  }
  return 'normal';
}

function normalizeExecutionMode(value: unknown): ZcodeExecutionMode {
  if (value === 'cli') {
    return 'cli';
  }
  return 'api';
}

/** Detects API key and baseURL from local ~/.zcode configs if present. */
export function detectLocalZcodeCredentials(): { apiKey?: string; baseURL?: string } {
  try {
    const candidatePaths = [
      path.join(os.homedir(), '.zcode', 'v2', 'config.json'),
      path.join(os.homedir(), '.zcode', 'cli', 'config.json'),
    ];
    for (const candidate of candidatePaths) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
      const providers = parsed?.provider ?? {};
      const priorityKeys = [
        'builtin:zai-coding-plan',
        'builtin:zai',
        'builtin:zai-start-plan',
        'builtin:bigmodel-coding-plan',
        'builtin:bigmodel',
      ];
      for (const pKey of priorityKeys) {
        const apiKey = providers[pKey]?.options?.apiKey;
        if (typeof apiKey === 'string' && apiKey.trim()) {
          const baseURL = providers[pKey]?.options?.baseURL;
          return {
            apiKey: apiKey.trim(),
            baseURL: typeof baseURL === 'string' && baseURL.trim() ? baseURL.trim() : undefined,
          };
        }
      }
    }
  } catch {
    // Non-fatal fallback
  }
  return {};
}

/** Read normalized ZCode settings from the global settings record. */
export function getZcodeProviderSettings(
  settings: Record<string, unknown>,
): PersistedZcodeProviderSettings {
  const config = getProviderConfig(settings, ZCODE_PROVIDER_ID);
  const detected = detectLocalZcodeCredentials();

  const explicitApiKey = asString(config.apiKey, '').trim();
  const apiKey = explicitApiKey || detected.apiKey || '';

  const explicitBaseURL = asString(config.baseURL, '').trim();
  const baseURL = explicitBaseURL || detected.baseURL || DEFAULT_ZCODE_PROVIDER_SETTINGS.baseURL;

  return {
    cliPath: asString(config.cliPath, DEFAULT_ZCODE_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabled: config.enabled === true,
    apiKey,
    baseURL,
    mode: normalizeExecutionMode(config.mode),
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_ZCODE_PROVIDER_SETTINGS.environmentVariables,
    ),
    customModels: asString(config.customModels, DEFAULT_ZCODE_PROVIDER_SETTINGS.customModels),
    reasoningEffort: normalizeReasoningEffort(config.reasoningEffort),
    permissionMode: normalizePermissionMode(config.permissionMode),
  };
}

export function updateZcodeProviderSettings(
  settings: Record<string, unknown>,
  updater: (current: PersistedZcodeProviderSettings) => PersistedZcodeProviderSettings,
): PersistedZcodeProviderSettings {
  const current = getZcodeProviderSettings(settings);
  const updated = updater(current);
  setProviderConfig(settings, ZCODE_PROVIDER_ID, {
    cliPath: updated.cliPath.trim(),
    cliPathsByHost: updated.cliPathsByHost,
    enabled: updated.enabled,
    apiKey: updated.apiKey.trim(),
    baseURL: updated.baseURL.trim(),
    mode: updated.mode,
    environmentVariables: updated.environmentVariables,
    customModels: updated.customModels,
    reasoningEffort: updated.reasoningEffort,
    permissionMode: updated.permissionMode,
  });
  return updated;
}

export function getResolvedZcodeCliPath(
  settings: PersistedZcodeProviderSettings,
  hostname = getHostnameKey(),
): string {
  const hostPath = settings.cliPathsByHost[hostname]?.trim();
  if (hostPath) {
    return hostPath;
  }
  return settings.cliPath.trim() || DEFAULT_ZCODE_PROVIDER_SETTINGS.cliPath;
}
