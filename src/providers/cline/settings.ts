import {
  DEFAULT_GOAL_LOOP_MAX_ITERATIONS,
  normalizeGoalLoopIterations,
} from '../../core/conversation/goalLoop';
import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';
import {
  type ClineApiProviderId,
  type ClineCompactionMode,
  type ClineThinkingLevel,
  isClineApiProvider,
  isClineCompactionMode,
  isClineThinkingLevel,
} from './types/models';

export const CLINE_PROVIDER_ID = 'cline';

export type ClinePermissionMode = 'normal' | 'yolo' | 'plan';

/**
 * How the goal loop decides a turn is finished.
 * - `marker`: trust only the agent's own `GOAL_ACHIEVED` line (free, one CLI call per turn)
 * - `verifier`: run a separate skeptical verification pass when the marker is missing
 *   or says "done" (costs one extra cheap call, catches premature completion)
 */
export type ClineGoalLoopVerification = 'marker' | 'verifier';

export interface PersistedClineProviderSettings {
  apiProvider: ClineApiProviderId;
  cliPath: string;
  cliPathsByHost: HostnameCliPaths;
  compaction: ClineCompactionMode;
  customModels: string;
  enabled: boolean;
  environmentVariables: string;
  /** Auto-loop turns until the standing `/goal` is actually reached. */
  goalLoopEnabled: boolean;
  goalLoopMaxIterations: number;
  goalLoopVerification: ClineGoalLoopVerification;
  permissionMode: ClinePermissionMode;
  retries: number;
  thinking: ClineThinkingLevel;
}

export const DEFAULT_CLINE_PROVIDER_SETTINGS: Readonly<PersistedClineProviderSettings> = Object.freeze({
  apiProvider: 'cline-pass',
  cliPath: '',
  cliPathsByHost: {},
  compaction: 'agentic',
  customModels: '',
  enabled: false,
  environmentVariables: '',
  goalLoopEnabled: true,
  goalLoopMaxIterations: DEFAULT_GOAL_LOOP_MAX_ITERATIONS,
  goalLoopVerification: 'verifier',
  permissionMode: 'yolo',
  retries: 6,
  thinking: 'medium',
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

function normalizeRetries(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CLINE_PROVIDER_SETTINGS.retries;
  }
  return Math.min(10, Math.max(1, Math.round(value)));
}

function normalizePermissionMode(value: unknown): ClinePermissionMode {
  if (value === 'normal' || value === 'yolo' || value === 'plan') {
    return value;
  }
  return DEFAULT_CLINE_PROVIDER_SETTINGS.permissionMode;
}

function normalizeGoalLoopVerification(value: unknown): ClineGoalLoopVerification {
  return value === 'marker' || value === 'verifier'
    ? value
    : DEFAULT_CLINE_PROVIDER_SETTINGS.goalLoopVerification;
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
    goalLoopEnabled: config.goalLoopEnabled !== false,
    goalLoopMaxIterations: normalizeGoalLoopIterations(config.goalLoopMaxIterations),
    goalLoopVerification: normalizeGoalLoopVerification(config.goalLoopVerification),
    permissionMode: normalizePermissionMode(config.permissionMode),
    retries: normalizeRetries(config.retries),
    thinking: isClineThinkingLevel(config.thinking)
      ? config.thinking
      : DEFAULT_CLINE_PROVIDER_SETTINGS.thinking,
    compaction: isClineCompactionMode(config.compaction)
      ? config.compaction
      : DEFAULT_CLINE_PROVIDER_SETTINGS.compaction,
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
    goalLoopMaxIterations: updates.goalLoopMaxIterations !== undefined
      ? normalizeGoalLoopIterations(updates.goalLoopMaxIterations)
      : current.goalLoopMaxIterations,
    goalLoopVerification: updates.goalLoopVerification
      ? normalizeGoalLoopVerification(updates.goalLoopVerification)
      : current.goalLoopVerification,
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
