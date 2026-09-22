import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { clearTimeout, setTimeout } from 'timers';

export type DesktopBridgeProviderId = 'grok-bot' | 'perplexity-chat';
export const desktopBridgeProviders = [
  { id: 'grok-bot', displayName: 'Grok Bot (Desktop, experimentell)', bundleId: 'com.anysphere.sand' },
  { id: 'perplexity-chat', displayName: 'Perplexity Chat (Desktop, experimentell)', bundleId: 'ai.perplexity.macv3' },
] as const;
export const desktopBridgeStatus = 'Experimentelles UI-Relay: geöffneter Chat, keine nativen App-Tools. Lokale Werkzeuge nur nach Einzelfreigabe. Abbruch beendet nur das lokale Warten; niemals automatisch erneut senden.';
const queues = new Map<string, Promise<unknown>>();
export function runSerialized<T>(app: string, operation: () => Promise<T>): Promise<T> {
  app = 'global-desktop';
  const result = (queues.get(app) ?? Promise.resolve()).catch(() => undefined).then(operation);
  queues.set(app, result);
  void result.finally(() => { if (queues.get(app) === result) queues.delete(app); }).catch(() => undefined);
  return result;
}
export function extractReply(value: string, nonce: string): string {
  const begin = `BEGIN_${nonce}\n`;
  const end = `\nEND_${nonce}`;
  if (!value.startsWith(begin) || !value.endsWith(end)) throw new Error('Antwort nicht eindeutig zugeordnet');
  return value.slice(begin.length, value.indexOf(end));
}
export interface DesktopBridgeRequest {
  provider: DesktopBridgeProviderId;
  prompt: string;
  /** Exact existing visible text in the user-selected conversation. */
  anchor: string;
  helperPath: string;
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}
/** Not a vendor API. Explicit visible requests only; never use for auxiliary/goal-loop calls. */
export function queryDesktopBridge(request: DesktopBridgeRequest): Promise<string> {
  return runSerialized(request.provider, () => new Promise<string>((resolve, reject) => {
    if (request.signal?.aborted) { reject(new Error('Abgebrochen')); return; }
    if (process.platform !== 'darwin' || !request.anchor || !request.prompt) { reject(new Error('macOS, Chat-Anker und Prompt erforderlich')); return; }
    request.onStatus?.(desktopBridgeStatus);
    const nonce = randomUUID();
    const child = spawn('/usr/bin/swift', [request.helperPath], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = ''; let error = ''; let settled = false;
    let pendingFailure: Error | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = (failure: Error) => {
      if (settled || pendingFailure) return;
      pendingFailure = failure;
      child.kill('SIGTERM');
      escalation = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    };
    const finish = (failure?: Error, value?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); if (escalation) clearTimeout(escalation);
      child.stdout.removeAllListeners('data'); child.stderr.removeAllListeners('data'); request.signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve(value ?? '');
    };
    const abort = () => { terminate(new Error('Abgebrochen. App-Auftrag läuft eventuell weiter; nicht erneut senden.')); };
    const timer = setTimeout(() => { terminate(new Error('Relay-Zeitlimit; nicht automatisch erneut senden.')); }, 110_000);
    request.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { if (pendingFailure || settled) return;
      if (output.length + chunk.length > 2_000_000) { terminate(new Error('Relay-Ausgabe zu groß')); return; }
      output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-8000); });
    child.on('error', (failure) => terminate(failure));
    child.stdin.on('error', (failure) => terminate(failure));
    child.on('close', (code) => {
      if (settled) return;
      if (pendingFailure) { finish(pendingFailure); return; }
      if (code !== 0) { finish(new Error(error || 'Relay fehlgeschlagen; nicht erneut senden.')); return; }
      try {
        const result: unknown = JSON.parse(output);
        if (!result || typeof result !== 'object' || !('nonce' in result) || result.nonce !== nonce || !('reply' in result) || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Ungültige Relay-Antwort');
        finish(undefined, result.reply);
      } catch (failure) { finish(failure instanceof Error ? failure : new Error('Ungültige Antwort')); }
    });
    if (request.signal?.aborted) { abort(); return; }
    child.stdin.end(JSON.stringify({ provider: request.provider, prompt: request.prompt, anchor: request.anchor, nonce }) + '\n');
  }));
}
