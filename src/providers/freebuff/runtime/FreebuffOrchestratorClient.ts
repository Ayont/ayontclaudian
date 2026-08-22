import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ExecLike = (file: string, args: string[]) => Promise<{ stdout: string }>;

export interface FreebuffThread {
  id: string;
  status?: string;
  turnState?: string;
  model?: string | null;
}

export interface FreebuffAuthStatus {
  authed: boolean;
  user?: { name?: string; email?: string };
}

/** Extract LISTEN ports from lsof output lines like `TCP 127.0.0.1:50599 (LISTEN)`. */
export function parseListenPorts(lsofOutput: string): number[] {
  const ports = new Set<number>();
  for (const match of lsofOutput.matchAll(/127\.0\.0\.1:(\d+)/g)) {
    const port = Number.parseInt(match[1], 10);
    if (Number.isInteger(port) && port > 0) {
      ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/**
 * The orchestrator is identified by its /healthz fingerprint: either a live
 * status payload or the launch-id rejection — both prove the desktop app's
 * Bun server owns the port, unlike anything else that happens to listen.
 */
export function isOrchestratorHealthPayload(status: number, body: string): boolean {
  if (status === 401 && body.includes('invalid launch id')) {
    return true;
  }
  if (status === 200) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return parsed.ok === true || typeof parsed.launchId === 'string';
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Loopback HTTP client for the Freebuff desktop orchestrator.
 *
 * The API is the same surface the desktop UI uses (verified live against
 * Freebuff.app 0.0.154): create threads, post messages, consume the SSE bus,
 * stop turns. The API gate checks loopback origin headers only, so plain
 * same-host requests pass without credentials.
 */
export class FreebuffOrchestratorClient {
  private cachedPort: number | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly execImpl: ExecLike;

  constructor(options?: { fetchImpl?: FetchLike; execImpl?: ExecLike }) {
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
    this.execImpl = options?.execImpl ?? ((file, args) => execFileAsync(file, args));
  }

  forgetPort(): void {
    this.cachedPort = null;
  }

  baseUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  /**
   * Find and validate the orchestrator port: explicit override first, then
   * pgrep the orchestrator process and fingerprint its listening ports.
   * Returns null when the desktop app is not running.
   */
  async discoverPort(portOverride?: string): Promise<number | null> {
    if (this.cachedPort !== null) {
      return this.cachedPort;
    }
    const override = Number.parseInt((portOverride ?? '').trim(), 10);
    if (Number.isInteger(override) && override > 0 && await this.healthCheck(override)) {
      this.cachedPort = override;
      return override;
    }

    let pids: string;
    try {
      pids = (await this.execImpl('pgrep', ['-f', 'orchestrator'])).stdout;
    } catch {
      return null;
    }
    for (const pid of pids.split('\n').map((line) => line.trim()).filter(Boolean)) {
      let lsofOut: string;
      try {
        lsofOut = (await this.execImpl('lsof', ['-nP', '-p', pid, '-iTCP', '-sTCP:LISTEN'])).stdout;
      } catch {
        continue;
      }
      for (const port of parseListenPorts(lsofOut)) {
        if (await this.healthCheck(port)) {
          this.cachedPort = port;
          return port;
        }
      }
    }
    return null;
  }

  /** True when the port answers with the orchestrator health fingerprint. */
  async healthCheck(port: number): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/healthz`);
      const body = await response.text();
      return isOrchestratorHealthPayload(response.status, body);
    } catch {
      return false;
    }
  }

  /** Login state; null when the orchestrator is unreachable. */
  async authStatus(port: number): Promise<FreebuffAuthStatus | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/auth/status`);
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as FreebuffAuthStatus;
    } catch {
      return null;
    }
  }

  /** Create a thread for a project directory; returns the created snapshot. */
  async createThread(
    port: number,
    params: { projectPath: string; title?: string; harnessId?: string; model?: string },
  ): Promise<FreebuffThread | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as FreebuffThread;
    } catch {
      return null;
    }
  }

  /** Post a user message; `{ok:true}` means the turn was accepted. */
  async postMessage(port: number, threadId: string, text: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as { ok?: boolean };
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  /** Ask the current turn to stop. Best-effort by design. */
  async stopTurn(port: number, threadId: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/stop`, { method: 'POST' });
    } catch {
      // The turn may already be finished; nothing to recover.
    }
  }

  /** Close a thread so it stops drawing desktop-app attention. Best-effort. */
  async closeThread(port: number, threadId: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/close`, { method: 'POST' });
    } catch {
      // Closing is courtesy cleanup, never a failure path.
    }
  }

  /** Open the SSE bus; caller reads response.body incrementally. */
  async openEventStream(port: number, signal: AbortSignal): Promise<Response | null> {
    try {
      return await this.fetchImpl(`${this.baseUrl(port)}/api/events`, { signal });
    } catch {
      return null;
    }
  }
}