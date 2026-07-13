import { type ChildProcess,spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { cpus } from 'node:os';

import { getEnhancedPath } from '../../utils/env';
import type { TranscriberOptions, TranscriptionResult } from './VoiceTranscriber';

export type SpawnLike = typeof spawn;
export type FetchLike = typeof fetch;

const HOST = '127.0.0.1';
const CANDIDATE_PORTS = [8123, 8124, 8125];
const HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const DEFAULT_MODEL_DIR = '~/.cache/whisper-cpp';

function expandHome(p: string): string {
  if (p.startsWith('~')) {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    return home + p.slice(1);
  }
  return p;
}

/**
 * Thread count for whisper.cpp: use most available cores, but keep a floor
 * (whisper.cpp's own default) and a ceiling — hybrid Big.Little CPUs see
 * diminishing (or negative) returns from oversubscribing every core, and this
 * runs alongside the user's normal work, not on a dedicated machine.
 */
export function resolveThreadCount(cpuCount: number): number {
  if (!Number.isFinite(cpuCount) || cpuCount <= 0) return 4;
  return Math.max(4, Math.min(8, Math.floor(cpuCount)));
}

interface ServerState {
  proc: ChildProcess;
  port: number;
  modelPath: string;
}

/**
 * Manages ONE persistent `whisper-server` child process, shared across every
 * push-to-talk recording in the session.
 *
 * `whisper-cli` reloads the entire model (142 MB–3 GB) from disk into memory
 * on EVERY single invocation. For a workflow used repeatedly during a
 * session, that reload is the single biggest latency cost — often dwarfing
 * the actual decode time for a short dictation clip. Keeping the model warm
 * in a background HTTP server turns every transcription after the first into
 * "decode only": dramatically faster, same accuracy, same local-only model.
 */
export interface WhisperServerManagerOptions {
  /** Ports to try, in order, if the previous one fails to come up. */
  candidatePorts?: number[];
  /** Total time to wait for the server to answer after spawning it. */
  healthTimeoutMs?: number;
  /** Delay between health-check polls while waiting for startup. */
  healthPollIntervalMs?: number;
}

export class WhisperServerManager {
  private state: ServerState | null = null;
  private starting: Promise<ServerState | null> | null = null;
  private readonly candidatePorts: number[];
  private readonly healthTimeoutMs: number;
  private readonly healthPollIntervalMs: number;

  constructor(
    private readonly spawnImpl: SpawnLike = spawn,
    private readonly fetchImpl: FetchLike = fetch,
    options: WhisperServerManagerOptions = {},
  ) {
    this.candidatePorts = options.candidatePorts ?? CANDIDATE_PORTS;
    this.healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
    this.healthPollIntervalMs = options.healthPollIntervalMs ?? HEALTH_POLL_INTERVAL_MS;
  }

  get isRunning(): boolean {
    return this.state !== null;
  }

  /** Whether the `whisper-server` binary is on PATH. Does not start it. */
  isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = this.spawnImpl('which', ['whisper-server'], {
          env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
          windowsHide: true,
        });
      } catch {
        resolve(false);
        return;
      }
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  }

  private async healthCheck(port: number): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`http://${HOST}:${port}/`, { method: 'GET' });
      // Any HTTP response — even a 404 for an unimplemented root route — means
      // the server process is up and accepting connections.
      return res.status > 0;
    } catch {
      return false;
    }
  }

  private async waitForHealth(port: number): Promise<boolean> {
    const deadline = Date.now() + this.healthTimeoutMs;
    for (;;) {
      if (await this.healthCheck(port)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => window.setTimeout(resolve, this.healthPollIntervalMs));
    }
  }

  /** Starts (or reuses) the server for the given model; restarts on model change or crash. */
  private async ensureStarted(modelPath: string, threads: number): Promise<ServerState | null> {
    if (this.state) {
      if (this.state.modelPath === modelPath && (await this.healthCheck(this.state.port))) {
        return this.state;
      }
      // Either a different model was requested, or the server died since the
      // last health check — either way, restart clean.
      this.stop();
    }

    if (this.starting) return this.starting;
    this.starting = this.startServer(modelPath, threads);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async startServer(modelPath: string, threads: number): Promise<ServerState | null> {
    for (const port of this.candidatePorts) {
      let proc: ChildProcess;
      try {
        proc = this.spawnImpl(
          'whisper-server',
          [
            '-m', modelPath,
            '-t', String(threads),
            '--host', HOST,
            '--port', String(port),
            '-l', 'auto',
            '-nt',
          ],
          {
            env: { ...process.env, PATH: getEnhancedPath(process.env.PATH) },
            windowsHide: true,
          },
        );
      } catch {
        continue; // e.g. binary vanished mid-loop — try the next port anyway is harmless.
      }

      let exited = false;
      proc.on('exit', () => { exited = true; });
      proc.on('error', () => { exited = true; });

      const healthy = await this.waitForHealth(port);
      if (healthy && !exited) {
        const state: ServerState = { proc, port, modelPath };
        this.state = state;
        // If the server crashes later, drop the stale reference so the next
        // transcribe() call restarts it instead of talking to a dead port.
        proc.on('exit', () => {
          if (this.state === state) this.state = null;
        });
        return state;
      }

      try {
        proc.kill('SIGTERM');
      } catch {
        // Already gone.
      }
      // Port was likely taken by something else — try the next candidate.
    }
    return null;
  }

  async transcribe(
    wavPath: string,
    options: TranscriberOptions,
    abortSignal?: AbortSignal,
  ): Promise<TranscriptionResult> {
    const modelPath = expandHome(
      options.modelPath ?? `${DEFAULT_MODEL_DIR}/ggml-${options.model ?? 'base'}.bin`,
    );
    const threads = resolveThreadCount(cpus().length);

    const server = await this.ensureStarted(modelPath, threads);
    if (!server) {
      return {
        ok: false,
        text: '',
        error: 'whisper-server konnte nicht gestartet werden (Port belegt oder Binary fehlt).',
      };
    }

    try {
      const buffer = await fs.readFile(wavPath);
      const form = new FormData();
      form.append('file', new Blob([buffer]), 'audio.wav');
      form.append('response_format', 'text');
      form.append('language', options.language || 'auto');

      const response = await this.fetchImpl(`http://${HOST}:${server.port}/inference`, {
        method: 'POST',
        body: form,
        signal: abortSignal,
      });

      if (!response.ok) {
        return { ok: false, text: '', error: `whisper-server antwortete mit HTTP ${response.status}` };
      }
      return { ok: true, text: (await response.text()).trim() };
    } catch (error) {
      if (abortSignal?.aborted) {
        return { ok: false, text: '', error: 'Abgebrochen' };
      }
      return {
        ok: false,
        text: '',
        error: error instanceof Error ? error.message : 'whisper-server-Anfrage fehlgeschlagen',
      };
    }
  }

  /** Stops the background server. Safe to call repeatedly / when not running. */
  stop(): void {
    if (!this.state) return;
    try {
      this.state.proc.kill('SIGTERM');
    } catch {
      // Already gone.
    }
    this.state = null;
  }
}

/**
 * Shared singleton — ONE warm whisper-server process for the whole plugin
 * lifetime, reused across every tab and every push-to-talk recording. Call
 * `.stop()` from the plugin's `onunload()` to avoid leaking the child process.
 */
export const whisperServerManager = new WhisperServerManager();
