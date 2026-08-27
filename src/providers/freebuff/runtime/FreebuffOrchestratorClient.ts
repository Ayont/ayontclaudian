import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ExecLike = (
  file: string,
  args: string[],
  options?: { signal?: AbortSignal },
) => Promise<{ stdout: string }>;

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
  if (status === 401) {
    // Desktop updates reworded the gate ('invalid launch id' -> 'missing or
    // invalid token'); both prove the Bun orchestrator owns the port.
    return body.includes('launch id') || body.includes('token');
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

export interface FreebuffProcessLaunchInfo {
  port?: number;
  launchId?: string;
}

/** Parses `ps eww` output: the desktop app exports PORT and
 *  FREEBUFF_LAUNCH_ID into the orchestrator process environment. */
export function parseProcessLaunchInfo(psOutput: string): FreebuffProcessLaunchInfo {
  const info: FreebuffProcessLaunchInfo = {};
  for (const match of psOutput.matchAll(/(?:^|\s)(PORT|FREEBUFF_LAUNCH_ID)=(\S+)/g)) {
    if (match[1] === 'PORT') {
      const port = Number.parseInt(match[2], 10);
      if (Number.isInteger(port) && port > 0) info.port = port;
    } else {
      info.launchId = match[2];
    }
  }
  return info;
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
  private cachedLaunchId: string | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly execImpl: ExecLike;

  constructor(options?: { fetchImpl?: FetchLike; execImpl?: ExecLike }) {
    this.fetchImpl = options?.fetchImpl ?? ((input, init) => fetch(input, init));
    this.execImpl = options?.execImpl ?? (async (file, args, execOptions) => {
      const result = await execFileAsync(file, args, {
        encoding: 'utf8',
        signal: execOptions?.signal,
      });
      return { stdout: result.stdout };
    });
  }

  forgetPort(): void {
    this.cachedPort = null;
    this.cachedLaunchId = null;
  }

  getLaunchId(): string | null {
    return this.cachedLaunchId;
  }

  /** The API gate requires the desktop app's launch id on every call. */
  private authHeaders(): Record<string, string> {
    return this.cachedLaunchId ? { 'x-freebuff-launch-id': this.cachedLaunchId } : {};
  }

  baseUrl(port: number): string {
    return `http://127.0.0.1:${port}`;
  }

  /**
   * Find and validate the orchestrator port: explicit override first, then
   * pgrep the orchestrator process and fingerprint its listening ports.
   * Returns null when the desktop app is not running.
   */
  async discoverPort(portOverride?: string, signal?: AbortSignal): Promise<number | null> {
    if (signal?.aborted) {
      return null;
    }
    if (this.cachedPort !== null) {
      // The desktop picks a new dynamic port on every restart, so a cached
      // port is only trusted while it still answers.
      if (await this.healthCheck(this.cachedPort, signal)) {
        return this.cachedPort;
      }
      if (signal?.aborted) {
        return null;
      }
      this.forgetPort();
    }
    const override = Number.parseInt((portOverride ?? '').trim(), 10);
    if (Number.isInteger(override) && override > 0 && await this.healthCheck(override, signal)) {
      this.cachedPort = override;
      return override;
    }
    if (signal?.aborted) {
      return null;
    }

    let pids: string;
    try {
      pids = (await this.execImpl('pgrep', ['-f', 'orchestrator'], { signal })).stdout;
    } catch {
      return null;
    }
    if (signal?.aborted) {
      return null;
    }
    for (const pid of pids.split('\n').map((line) => line.trim()).filter(Boolean)) {
      if (signal?.aborted) {
        return null;
      }
      // The process environment exports PORT and FREEBUFF_LAUNCH_ID — the most
      // direct answer, independent of which socket belongs to whom.
      let launchInfo: FreebuffProcessLaunchInfo = {};
      try {
        launchInfo = parseProcessLaunchInfo((await this.execImpl(
          'ps',
          ['eww', '-p', pid],
          { signal },
        )).stdout);
      } catch {
        // ps may be unavailable; lsof below still lists candidate ports.
      }
      if (signal?.aborted) {
        return null;
      }
      if (launchInfo.launchId) {
        this.cachedLaunchId = launchInfo.launchId;
      }
      const candidates: number[] = [];
      if (launchInfo.port) candidates.push(launchInfo.port);
      try {
        const lsofOut = (await this.execImpl(
          'lsof',
          ['-nP', '-p', pid, '-iTCP', '-sTCP:LISTEN'],
          { signal },
        )).stdout;
        candidates.push(...parseListenPorts(lsofOut));
      } catch {
        // No lsof candidates; the env port above already covers the happy path.
      }
      if (signal?.aborted) {
        return null;
      }
      for (const port of new Set(candidates)) {
        if (await this.healthCheck(port, signal)) {
          this.cachedPort = port;
          return port;
        }
        if (signal?.aborted) {
          return null;
        }
      }
    }
    return null;
  }

  /** True when the port answers with the orchestrator health fingerprint. */
  async healthCheck(port: number, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/healthz`, { signal });
      const body = await response.text();
      if (signal?.aborted) {
        return false;
      }
      return isOrchestratorHealthPayload(response.status, body);
    } catch {
      return false;
    }
  }

  /** Login state; null when the orchestrator is unreachable. */
  async authStatus(port: number): Promise<FreebuffAuthStatus | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/auth/status`, { headers: { ...this.authHeaders() } });
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
    signal?: AbortSignal,
  ): Promise<FreebuffThread | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/threads`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
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
  async postMessage(port: number, threadId: string, text: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/message`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
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
  async stopTurn(port: number, threadId: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/stop`, {
        method: 'POST',
        signal,
      });
    } catch {
      // The turn may already be finished; nothing to recover.
    }
  }

  /** Close a thread so it stops drawing desktop-app attention. Best-effort. */
  async closeThread(port: number, threadId: string, signal?: AbortSignal): Promise<void> {
    try {
      // The endpoint validates JSON even for an empty body (live verified).
      await this.fetchImpl(`${this.baseUrl(port)}/api/thread/${threadId}/close`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: '{}',
      });
    } catch {
      // Closing is courtesy cleanup, never a failure path.
    }
  }

  /** Open the SSE bus; caller reads response.body incrementally. */
  async openEventStream(port: number, signal: AbortSignal): Promise<Response | null> {
    try {
      return await this.fetchImpl(`${this.baseUrl(port)}/api/events`, {
        signal,
        headers: { ...this.authHeaders() },
      });
    } catch {
      return null;
    }
  }
}
