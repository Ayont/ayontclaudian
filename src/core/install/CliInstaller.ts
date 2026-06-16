import { type ChildProcess, spawn } from 'node:child_process';

import { getEnhancedPath } from '../../utils/env';

/** Progress of a running CLI install. `percent` is null while indeterminate. */
export interface InstallProgress {
  phase: 'starting' | 'running' | 'done' | 'error';
  percent: number | null;
  line?: string;
}

export type InstallProgressCallback = (progress: InstallProgress) => void;

export interface InstallResult {
  ok: boolean;
  error?: string;
}

const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s?%/;

/**
 * Extracts a 0–100 percentage from an installer output line, or null when the
 * line carries no percentage. Pure and exported for unit testing.
 */
export function parseInstallProgress(line: string): number | null {
  const match = line.match(PERCENT_RE);
  if (!match) {
    return null;
  }
  const percent = Math.round(Number(match[1]));
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.min(100, Math.max(0, percent));
}

/**
 * Runs a single CLI install command in a shell, streaming progress. The command
 * comes from the curated {@link CLI_INSTALL_CATALOG}; nothing here interpolates
 * user input. Resolves to {ok:false} on a non-zero exit instead of throwing.
 */
export class CliInstaller {
  private proc: ChildProcess | null = null;

  isRunning(): boolean {
    return this.proc !== null;
  }

  async run(
    command: string,
    onProgress: InstallProgressCallback,
    extraEnv?: Record<string, string>,
  ): Promise<InstallResult> {
    if (this.proc) {
      return { ok: false, error: 'Es läuft bereits eine Installation.' };
    }
    if (!command.trim()) {
      return { ok: false, error: 'Kein Installationsbefehl verfügbar.' };
    }

    onProgress({ phase: 'starting', percent: null });

    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/d', '/s', '/c', command] : ['-lc', command];
    const env = { ...process.env, ...extraEnv, PATH: getEnhancedPath(process.env.PATH) };

    return new Promise<InstallResult>((resolve) => {
      let proc: ChildProcess;
      try {
        proc = spawn(shell, args, { env, windowsHide: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Installation konnte nicht gestartet werden.';
        onProgress({ phase: 'error', percent: null, line: message });
        resolve({ ok: false, error: message });
        return;
      }

      this.proc = proc;
      let tailErr = '';

      const handleData = (chunk: Buffer | string): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.trim();
          if (!line) {
            continue;
          }
          onProgress({ phase: 'running', percent: parseInstallProgress(line), line });
        }
      };

      proc.stdout?.on('data', handleData);
      proc.stderr?.on('data', (chunk: Buffer | string) => {
        tailErr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        handleData(chunk);
      });

      proc.on('error', (error) => {
        this.proc = null;
        const message = error instanceof Error ? error.message : 'Installationsfehler';
        onProgress({ phase: 'error', percent: null, line: message });
        resolve({ ok: false, error: message });
      });

      proc.on('close', (code) => {
        this.proc = null;
        if (code === 0) {
          onProgress({ phase: 'done', percent: 100 });
          resolve({ ok: true });
          return;
        }
        const detail = tailErr.trim().slice(-300);
        const message = `Installation fehlgeschlagen (Code ${code}).${detail ? ` ${detail}` : ''}`;
        onProgress({ phase: 'error', percent: null, line: message });
        resolve({ ok: false, error: message });
      });
    });
  }

  /** Terminates a running install (best-effort). */
  cancel(): void {
    if (this.proc) {
      try {
        this.proc.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.proc = null;
    }
  }
}
