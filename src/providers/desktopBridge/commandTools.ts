import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'timers';

// Deliberately exclude inherited PATH, cwd, NODE_OPTIONS and credential variables.
export const COMMAND_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
export interface CommandOutput { data: string; exitCode: number | null; signal: string | null; timedOut: boolean; cancelled: boolean; outputTruncated: boolean; }
export function resolveCommand(command: string): { executable: string; identity: string } {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/.test(command)) throw new Error('Nur Programmname aus festem Host-PATH erlaubt.');
  for (const directory of COMMAND_PATH.split(':')) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const executable = fs.realpathSync(candidate);
      const stat = fs.statSync(executable);
      if (!stat.isFile()) continue;
      return { executable, identity: [executable, stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':') };
    } catch { /* Try the next trusted directory. */ }
  }
  throw new Error('Programm nicht im festen Host-PATH installiert.');
}
export function runCommand(executable: string, args: readonly string[], cwd: string, timeout: number, signal: AbortSignal, enabled: () => boolean): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    if (signal.aborted || !enabled()) { reject(new Error('Abgebrochen oder Befehle deaktiviert.')); return; }
    const child = spawn(executable, [...args], { cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: COMMAND_PATH, HOME: os.homedir(), LANG: 'en_US.UTF-8', TMPDIR: os.tmpdir() } });
    let data = ''; let outputTruncated = false; let timedOut = false; let cancelled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const kill = (kind: NodeJS.Signals) => { if (child.pid) { try { process.kill(-child.pid, kind); } catch { /* Already exited. */ } } };
    const stop = () => { if (escalation) return; kill('SIGTERM'); escalation = setTimeout(() => kill('SIGKILL'), 250); };
    const cancel = () => { cancelled = true; stop(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    const revoke = setInterval(() => { if (!enabled()) cancel(); }, 100);
    let retainedBytes = 0;
    const collect = (text: string) => {
      if (outputTruncated) return;
      for (const character of text) {
        const bytes = Buffer.byteLength(character, 'utf8');
        if (retainedBytes + bytes > 32768) { outputTruncated = true; break; }
        data += character; retainedBytes += bytes;
      }
    };
    // Each stream owns its decoder: pipe chunks can split a UTF-8 code point.
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted || !enabled()) cancel();
    let drain: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); clearInterval(revoke); signal.removeEventListener('abort', cancel); if (escalation) clearTimeout(escalation); if (drain) clearTimeout(drain); kill('SIGKILL'); };
    // Descendants can hold the pipes open after the leader exits. Reap the
    // original process group at exit, rather than waiting for pipe close.
    child.once('exit', () => {
      clearTimeout(timer); kill('SIGKILL');
      // A setsid escape is not contained; it must not keep this turn pending.
      drain = setTimeout(() => {
        outputTruncated = true;
        child.stdout.destroy(); child.stderr.destroy();
      }, 250);
    });
    child.once('error', () => { cleanup(); reject(new Error('Host-Programm konnte nicht gestartet werden.')); });
    child.once('close', (exitCode, exitSignal) => { cleanup(); resolve({ data, exitCode, signal: exitSignal, timedOut, cancelled, outputTruncated }); });
  });
}
export function commandPage(output: CommandOutput, offset = 0): string {
  let end = Math.min(output.data.length, offset + 700);
  while (end >= offset) {
    const result = JSON.stringify({ ...output, data: output.data.slice(offset, end), offset, nextOffset: end < output.data.length ? end : null, total: output.data.length });
    if (result.length <= 1100) return result;
    end--;
  }
  throw new Error('Werkzeugergebnis zu groß.');
}
