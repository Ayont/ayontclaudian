/**
 * Claudian - Provider health check
 *
 * Goes beyond "the CLI path resolves" by actually invoking each provider binary
 * with `--version` and reporting whether it answered. Surfaced by the
 * "Check provider health" command so you instantly see which providers are really
 * usable right now (not just configured).
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

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

  return new Promise<ProbeResult>((resolve) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(options.command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: 'pipe',
        windowsHide: true,
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
