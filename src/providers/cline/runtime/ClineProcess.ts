import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { findCliBinaryPath } from '../../../utils/cliBinaryLocator';
import { getEnhancedPath } from '../../../utils/env';
import {
  resolveWindowsCmdShimSpawnSpec,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';

export function isElectronHostBinary(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.includes('obsidian') || lower.includes('electron');
}

export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sanitizeClineSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (key.startsWith('ELECTRON_') || key === 'ATOM_SHELL_INTERNAL_RUN_AS_NODE') {
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function resolveHostNodeBinary(additionalPath?: string): string | null {
  const fromPath = findCliBinaryPath('node', additionalPath);
  if (fromPath && !isElectronHostBinary(fromPath)) {
    return fromPath;
  }
  if (process.execPath && !isElectronHostBinary(process.execPath)) {
    return process.execPath;
  }
  return null;
}

export function resolveClineSpawnSpec(spec: {
  args: string[];
  command: string;
}): WindowsCmdShimSpawnSpec {
  if (process.platform === 'win32') {
    return resolveWindowsCmdShimSpawnSpec(spec);
  }

  const commandName = path.basename(spec.command);
  const nodeBin = commandName === 'cline' || commandName === 'cline.js'
    ? resolveHostNodeBinary(path.isAbsolute(spec.command) ? path.dirname(spec.command) : undefined)
    : null;
  if (nodeBin) {
    return {
      args: [spec.command, ...spec.args],
      command: nodeBin,
    };
  }

  return {
    args: spec.args,
    command: spec.command,
  };
}

export function spawnClineProcess(options: {
  args: string[];
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): { proc: ChildProcessWithoutNullStreams; spawnSpec: WindowsCmdShimSpawnSpec } {
  const spawnSpec = resolveClineSpawnSpec({
    args: options.args,
    command: options.command,
  });
  const env = sanitizeClineSpawnEnv({
    ...options.env,
    PATH: getEnhancedPath(
      options.env?.PATH,
      path.isAbsolute(options.command) ? options.command : undefined,
    ),
  });
  const proc = spawn(spawnSpec.command, spawnSpec.args, {
    cwd: options.cwd,
    env,
    stdio: 'pipe',
    windowsHide: true,
    ...(spawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
  return { proc, spawnSpec };
}

export function probeClineVersion(
  command: string,
  timeoutMs = 20_000,
): Promise<{ detail?: string; ok: boolean; output: string }> {
  return new Promise((resolve) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawnClineProcess({
        args: ['--version'],
        command,
        env: process.env,
      }).proc;
    } catch (error) {
      resolve({
        ok: false,
        output: '',
        detail: error instanceof Error ? error.message : 'spawn failed',
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { detail?: string; ok: boolean; output: string }): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      try {
        proc.kill('SIGKILL');
      } catch {
        // already gone
      }
      resolve(result);
    };

    const timer = window.setTimeout(
      () => finish({ ok: false, output: stdout, detail: 'timed out' }),
      timeoutMs,
    );
    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });
    proc.on('error', (error) => finish({ ok: false, output: stdout, detail: error.message }));
    proc.on('close', (code) => {
      const output = stdout.trim() || stderr.trim();
      finish(code === 0
        ? { ok: true, output }
        : { ok: false, output, detail: `exit code ${code}` });
    });
  });
}
