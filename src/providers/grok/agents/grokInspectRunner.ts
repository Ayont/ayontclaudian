import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import { resolveWindowsCmdShimSpawnSpec, terminateSpawnedProcess } from '../../../utils/windowsCmdShim';

export const GROK_INSPECT_TIMEOUT_MS = 15_000;

export interface GrokInspectRunnerOptions {
  resolveCommand: () => string | null;
  resolveCwd: () => string;
  resolveEnv: (command: string) => NodeJS.ProcessEnv;
}

/** Inspect needs stdout-only JSON, not the generic health probe's stderr fallback. */
export function createGrokInspectRunner(options: GrokInspectRunnerOptions): () => Promise<string> {
  return async () => {
    const command = options.resolveCommand();
    if (!command) throw new Error('Grok CLI wurde nicht gefunden.');
    const spec = resolveWindowsCmdShimSpawnSpec({ command, args: ['inspect', '--json'] });
    const cwd = options.resolveCwd();
    if (!cwd.trim()) throw new Error('Der Vault-Pfad für die Grok-Bot-Abfrage fehlt.');
    const env = options.resolveEnv(command);

    return new Promise<string>((resolve, reject) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(spec.command, spec.args, {
          cwd, env, stdio: 'pipe', windowsHide: true,
          ...(spec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        });
      } catch {
        reject(new Error('Die Grok-Bot-Abfrage konnte nicht gestartet werden.'));
        return;
      }
      let stdout = '';
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        // This process runner also runs outside a browser window.
        // eslint-disable-next-line obsidianmd/prefer-window-timers
        clearTimeout(timer);
        proc.stdout.removeAllListeners('data');
        proc.stdin.destroy();
        proc.stdout.destroy();
        proc.stderr.destroy();
        if (error) {
          try { terminateSpawnedProcess(proc, 'SIGKILL', spawn, spec); } catch { /* Already exited. */ }
          reject(error);
        } else {
          resolve(stdout);
        }
      };
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- Process lifetime is independent of any popout window.
      const timer = setTimeout(() => finish(new Error('Die Grok-Bot-Abfrage hat das Zeitlimit überschritten.')), GROK_INSPECT_TIMEOUT_MS);
      let outputBytes = 0;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk: string) => {
        outputBytes += Buffer.byteLength(chunk, 'utf8');
        if (outputBytes > 4 * 1024 * 1024) {
          finish(new Error('Die Grok-Bot-Liste ist zu groß.'));
          return;
        }
        stdout += chunk;
      });
      for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
        stream.on('error', () => finish(new Error('Die Grok-Bot-Abfrage ist fehlgeschlagen.')));
      }
      proc.stderr.resume();
      proc.on('error', () => finish(new Error('Die Grok-Bot-Abfrage konnte nicht gestartet werden.')));
      proc.on('close', (code) => {
        if (code !== 0) {
          finish(new Error('Die Grok-Bot-Abfrage ist fehlgeschlagen.'));
        } else {
          finish(stdout.trim() ? undefined : new Error('Grok hat keine Bot-Liste zurückgegeben.'));
        }
      });
      proc.stdin.end();
    });
  };
}
