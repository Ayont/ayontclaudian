/**
 * Claudian - Provider health check
 *
 * Goes beyond "the CLI path resolves" by actually invoking each provider binary
 * with `--version` and reporting whether it answered. Surfaced by the
 * "Check provider health" command so you instantly see which providers are really
 * usable right now (not just configured).
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { getEnhancedPath } from '../../utils/env';
import { resolveWindowsCmdShimSpawnSpec } from '../../utils/windowsCmdShim';
import { resolveProviderCliPath } from '../install/cliDetection';
import { getRuntimeEnvironmentVariables } from '../providers/providerEnvironment';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderId } from '../providers/types';

export interface HealthCheckResult {
  providerId: string;
  name: string;
  /** False when the provider is disabled or its CLI path does not resolve. */
  configured: boolean;
  /** True when the binary answered `--version` with exit code 0. */
  reachable: boolean;
  /** First non-empty `--version` output line, when reachable. */
  version?: string;
  /** Reason string when not reachable / not configured. */
  detail?: string;
}

export interface ProbeOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeoutMs?: number;
}

export interface ProbeResult {
  ok: boolean;
  output: string;
  detail?: string;
}

/** Default version probe timeout. */
export const HEALTH_PROBE_TIMEOUT_MS = 5000;

/**
 * Spawns `command --version` (configurable) and resolves once it exits or times out.
 * Never throws — failures resolve to `{ ok: false, detail }`.
 */
export function probeCli(options: ProbeOptions): Promise<ProbeResult> {
  const args = options.args ?? ['--version'];
  const timeoutMs = options.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;
  const resolved = resolveWindowsCmdShimSpawnSpec({ command: options.command, args });

  return new Promise<ProbeResult>((resolve) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(resolved.command, resolved.args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'pipe',
        windowsHide: true,
        ...(resolved.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (error) {
      resolve({ ok: false, output: '', detail: error instanceof Error ? error.message : 'spawn failed' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        proc.kill('SIGKILL');
      } catch {
        // process already gone
      }
      resolve(result);
    };

    const timer = window.setTimeout(() => finish({ ok: false, output: stdout, detail: 'timed out' }), timeoutMs);

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.on('error', (error) => finish({ ok: false, output: stdout, detail: error.message }));
    proc.on('close', (code) => {
      const output = (stdout.trim() || stderr.trim());
      finish(
        code === 0
          ? { ok: true, output }
          : { ok: false, output, detail: `exit code ${code}` },
      );
    });
  });
}

/** First non-empty line of `--version` output (where the version usually lives). */
export function firstOutputLine(output: string): string {
  return (output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';
}

function statusIcon(result: HealthCheckResult): string {
  if (!result.configured) return '➖';
  return result.reachable ? '✅' : '❌';
}

/** Renders a Markdown table of health-check results. Pure. */
export function formatHealthReportMarkdown(results: HealthCheckResult[]): string {
  const reachable = results.filter((r) => r.reachable).length;
  const configured = results.filter((r) => r.configured).length;

  const lines: string[] = [];
  lines.push('### Provider health');
  lines.push('');
  lines.push(`${reachable}/${configured} configured providers reachable.`);
  lines.push('');
  lines.push('| Provider | Status | Detail |');
  lines.push('| --- | :---: | --- |');
  for (const result of results) {
    const detail = result.reachable
      ? (result.version || 'ok')
      : (result.detail ?? (result.configured ? 'unreachable' : 'not configured'));
    lines.push(`| ${result.name} | ${statusIcon(result)} | ${detail} |`);
  }
  return lines.join('\n');
}

export interface ProviderHealthCheckOptions {
  cwd?: string;
  timeoutMs?: number;
  args?: string[];
  /** Use a fresh probe even when a cached result is still valid. */
  force?: boolean;
}

export interface ProviderHealthCheckResult {
  ok: boolean;
  providerId: ProviderId;
  command: string | null;
  version?: string;
  detail?: string;
}

interface CachedHealthResult {
  result: ProviderHealthCheckResult;
  expiresAt: number;
}

// A successful chat turn already proves that the provider is healthy. Keep the
// inexpensive CLI probe cached long enough that normal back-to-back prompts do
// not keep paying a subprocess startup penalty, while still rechecking often.
const HEALTH_CHECK_CACHE_TTL_MS = 60_000;
const healthCheckCache = new Map<ProviderId, CachedHealthResult>();

export function clearHealthCheckCache(): void {
  healthCheckCache.clear();
}

function getCachedResult(providerId: ProviderId): ProviderHealthCheckResult | null {
  const cached = healthCheckCache.get(providerId);
  if (!cached) {
    return null;
  }
  if (Date.now() > cached.expiresAt) {
    healthCheckCache.delete(providerId);
    return null;
  }
  return cached.result;
}

function setCachedResult(providerId: ProviderId, result: ProviderHealthCheckResult): void {
  healthCheckCache.set(providerId, {
    result,
    expiresAt: Date.now() + HEALTH_CHECK_CACHE_TTL_MS,
  });
}

/**
 * Probe a single provider's CLI with `--version`. Caches the result for
 * 60 seconds so normal chat turns do not spawn repeatedly.
 */
export async function checkProviderHealth(
  providerId: ProviderId,
  settings: Record<string, unknown>,
  options: ProviderHealthCheckOptions = {},
): Promise<ProviderHealthCheckResult> {
  if (!options.force) {
    const cached = getCachedResult(providerId);
    if (cached) {
      return cached;
    }
  }

  if (!ProviderRegistry.getRegisteredProviderIds().includes(providerId)) {
    const result: ProviderHealthCheckResult = {
      ok: false,
      providerId,
      command: null,
      detail: 'unknown provider',
    };
    setCachedResult(providerId, result);
    return result;
  }

  const enabled = ProviderRegistry.isEnabled(providerId, settings);
  const command = resolveProviderCliPath(providerId, settings);

  if (!enabled || !command) {
    const result: ProviderHealthCheckResult = {
      ok: false,
      providerId,
      command,
      detail: enabled ? 'CLI not found' : 'disabled',
    };
    setCachedResult(providerId, result);
    return result;
  }

  const env = {
    ...process.env,
    ...getRuntimeEnvironmentVariables(settings, providerId),
    PATH: getEnhancedPath(process.env.PATH, path.isAbsolute(command) ? command : undefined),
  };

  const probe = await probeCli({
    command,
    args: options.args,
    env,
    cwd: options.cwd,
    timeoutMs: options.timeoutMs,
  });

  const result: ProviderHealthCheckResult = {
    ok: probe.ok,
    providerId,
    command,
    version: probe.ok ? firstOutputLine(probe.output) : undefined,
    detail: probe.ok ? undefined : probe.detail,
  };
  setCachedResult(providerId, result);
  return result;
}

export interface EnsureProviderHealthyResult {
  ok: boolean;
  error?: string;
  providerId: ProviderId;
}

/**
 * Pre-flight check used before starting a chat turn. Returns a structured
 * error result instead of throwing so callers can surface it inline.
 */
export async function ensureProviderHealthy(
  providerId: ProviderId,
  settings: Record<string, unknown>,
  options?: ProviderHealthCheckOptions,
): Promise<EnsureProviderHealthyResult> {
  if (!ProviderRegistry.getRegisteredProviderIds().includes(providerId)) {
    // Defensive: unregistered provider ids only occur in tests/mocks. Treat as
    // healthy so mock runtimes continue to work.
    return { ok: true, providerId };
  }

  const health = await checkProviderHealth(providerId, settings, options);
  if (health.ok) {
    return { ok: true, providerId };
  }

  const displayName = ProviderRegistry.getProviderDisplayName(providerId);
  const reason = health.detail ?? 'unreachable';
  const error = health.command
    ? `${displayName} is not reachable (${reason}). Check the CLI path and try again.`
    : `${displayName} CLI not found. Install or configure the CLI path.`;

  return { ok: false, error, providerId };
}
