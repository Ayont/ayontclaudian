import { getProviderConfig, setProviderConfig } from '../../core/providers/providerConfig';
import type { HostnameCliPaths } from '../../core/types/settings';
import { getHostnameKey } from '../../utils/env';

export const ANTIGRAVITY_PROVIDER_ID = 'antigravity';

/**
 * Workspace scope for the spawned `agy` CLI.
 *
 * - `vault-only` (default): pass only `--add-dir <vault>`, so the agent is
 *   confined to the vault directory.
 * - `allow-home`: additionally allow the agent to roam the home directory
 *   (adds `--add-dir <home>`), for cross-project work.
 */
export type AntigravityWorkspaceScope = 'vault-only' | 'allow-home';

/**
 * Permission posture for the spawned `agy --print` run.
 *
 * - `yolo` (default): pass `--dangerously-skip-permissions`. This is the only
 *   posture that works unattended, because `--print` is non-interactive and
 *   cannot answer permission prompts. Kept as the default for that reason.
 * - `sandbox`: pass `--sandbox` (run inside agy's OS sandbox) and do NOT skip
 *   permissions, trading unattended convenience for an extra isolation layer.
 */
export type AntigravityPermissionMode = 'yolo' | 'sandbox';

/**
 * Builtin agent personas exposed by `agy --agent` (agy >= 1.1.1; list via
 * `agy agents`). `'default'` omits the flag and lets agy use its own default
 * persona. Keep the concrete names in sync with `agy agents`.
 */
export const ANTIGRAVITY_AGENT_PRESETS = [
  'accessibility_specialist',
  'analytics_engineer',
  'api_designer',
  'architect',
  'code-reviewer',
  'code_reviewer',
  'coder',
  'compliance_reviewer',
  'content_strategist',
  'copywriter',
  'data_engineer',
  'debugger',
  'design_system_engineer',
  'devops_engineer',
  'i18n_specialist',
  'performance_engineer',
  'product_manager',
  'refactor',
  'security_engineer',
  'seo_specialist',
  'technical_writer',
  'tester',
  'ux_designer',
] as const;

export type AntigravityAgent = 'default' | typeof ANTIGRAVITY_AGENT_PRESETS[number];

const ANTIGRAVITY_AGENT_SET = new Set<string>(ANTIGRAVITY_AGENT_PRESETS);

/** Normalizes a raw agent value; anything unrecognized falls back to `'default'`. */
export function normalizeAntigravityAgent(value: unknown): AntigravityAgent {
  return typeof value === 'string' && ANTIGRAVITY_AGENT_SET.has(value)
    ? (value as AntigravityAgent)
    : 'default';
}

/** Settings persisted for the Antigravity provider. */
export interface PersistedAntigravityProviderSettings {
  /** Explicit path to the `agy` binary (overrides PATH discovery). */
  cliPath: string;
  /** Hostname-keyed CLI paths, so a synced vault can target per-machine binaries. */
  cliPathsByHost: HostnameCliPaths;
  /** Whether the provider is selectable / enabled. */
  enabled: boolean;
  /** Extra environment variables (newline `KEY=VALUE` list) for the spawned CLI. */
  environmentVariables: string;
  /**
   * Permission posture: `yolo` adds `--dangerously-skip-permissions`,
   * `sandbox` adds `--sandbox` and skips nothing.
   */
  permissionMode: AntigravityPermissionMode;
  /** Optional `--print-timeout <value>` (e.g. `10m`); empty leaves it unset. */
  printTimeout: string;
  /** How much of the filesystem the agent may access. */
  workspaceScope: AntigravityWorkspaceScope;
  /** Builtin persona passed via `--agent` (agy >= 1.1.1); `'default'` omits the flag. */
  agent: AntigravityAgent;
}

export const DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS: Readonly<PersistedAntigravityProviderSettings> =
  Object.freeze({
    cliPath: '',
    cliPathsByHost: {},
    enabled: false,
    environmentVariables: '',
    permissionMode: 'yolo',
    printTimeout: '',
    workspaceScope: 'vault-only',
    agent: 'default',
  });

function normalizeWorkspaceScope(value: unknown): AntigravityWorkspaceScope {
  return value === 'allow-home' ? 'allow-home' : 'vault-only';
}

/**
 * Resolve the permission posture from raw config, migrating the legacy
 * `sandbox: boolean` field: an explicit `permissionMode` wins, otherwise a
 * truthy legacy `sandbox` maps to `'sandbox'`, and everything else defaults to
 * `'yolo'` (the prior always-on `--dangerously-skip-permissions` behavior).
 */
function normalizePermissionMode(
  permissionMode: unknown,
  legacySandbox: unknown,
): AntigravityPermissionMode {
  if (permissionMode === 'sandbox' || permissionMode === 'yolo') {
    return permissionMode;
  }
  return legacySandbox === true ? 'sandbox' : 'yolo';
}

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

/** Read normalized Antigravity settings from the global settings record. */
export function getAntigravityProviderSettings(
  settings: Record<string, unknown>,
): PersistedAntigravityProviderSettings {
  const config = getProviderConfig(settings, ANTIGRAVITY_PROVIDER_ID);
  return {
    cliPath: asString(config.cliPath, DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.cliPath).trim(),
    cliPathsByHost: normalizeHostnameCliPaths(config.cliPathsByHost),
    enabled: config.enabled === true,
    environmentVariables: asString(
      config.environmentVariables,
      DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.environmentVariables,
    ),
    permissionMode: normalizePermissionMode(config.permissionMode, config.sandbox),
    printTimeout: asString(
      config.printTimeout,
      DEFAULT_ANTIGRAVITY_PROVIDER_SETTINGS.printTimeout,
    ).trim(),
    workspaceScope: normalizeWorkspaceScope(config.workspaceScope),
    agent: normalizeAntigravityAgent(config.agent),
  };
}

/** Merge a partial update into the persisted Antigravity settings. */
export function updateAntigravityProviderSettings(
  settings: Record<string, unknown>,
  updates: Partial<PersistedAntigravityProviderSettings>,
): PersistedAntigravityProviderSettings {
  const current = getAntigravityProviderSettings(settings);
  const next: PersistedAntigravityProviderSettings = {
    ...current,
    ...updates,
    cliPathsByHost: updates.cliPathsByHost
      ? normalizeHostnameCliPaths(updates.cliPathsByHost)
      : current.cliPathsByHost,
    permissionMode: 'permissionMode' in updates
      ? normalizePermissionMode(updates.permissionMode, undefined)
      : current.permissionMode,
  };
  // Persist `next` only (no legacy `sandbox` field), so the migrated config
  // replaces any stale `sandbox` boolean on the next write.
  setProviderConfig(settings, ANTIGRAVITY_PROVIDER_ID, { ...next });
  return next;
}

/** Best CLI path hint from settings for the current host (no PATH fallback). */
export function getConfiguredAntigravityCliPath(
  settings: PersistedAntigravityProviderSettings,
): string {
  const hostKey = getHostnameKey();
  const hostPath = settings.cliPathsByHost[hostKey];
  if (typeof hostPath === 'string' && hostPath.trim()) {
    return hostPath.trim();
  }
  return settings.cliPath.trim();
}
