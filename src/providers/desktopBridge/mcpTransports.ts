import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { isAbsolute } from 'path';
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'timers';

import type { ManagedMcpServer, McpStdioServerConfig } from '../../core/types/mcp';
import { COMMAND_PATH } from './commandTools';

const WIRE_BYTES = 131072;
const SESSION_BYTES = 2097152;
const failure = () => new Error('MCP: Transport beendet (Limit, Protokoll oder Berechtigung). Keine automatische Wiederholung.');
// Protocol error details bypass tool-result consent and may echo credentials.
function safeMessage(message: JSONRPCMessage): JSONRPCMessage {
  return 'error' in message
    ? { jsonrpc: '2.0', id: message.id, error: { code: message.error.code, message: 'MCP: Server-Protokollfehler.' } }
    : message;
}

export interface DesktopMcpTransportOptions {
  /** Trusted, explicitly approved working directory, never model input. */
  cwd: string;
  /** Recheck live consent/configuration/binding before every write/fetch. */
  assertCurrent: () => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Trusted host test seam only. */
  fetch?: FetchLike;
}

class GroupStdioTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  private child?: ChildProcessWithoutNullStreams;
  private closed?: Promise<void>;
  private started = false;
  private stopped = false;
  private readonly buffer = new ReadBuffer({ maxBufferSize: WIRE_BYTES });
  private bytes = 0;
  private frames = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private watch?: ReturnType<typeof setInterval>;
  private readonly abort = () => { void this.close(); };
  constructor(private readonly config: McpStdioServerConfig, private readonly options: DesktopMcpTransportOptions) {}
  private check(): void {
    if (this.stopped || this.options.signal?.aborted) throw failure();
    this.options.assertCurrent();
  }
  private fail(): void { this.onerror?.(failure()); void this.close(); }
  async start(): Promise<void> {
    this.check();
    if (this.started || process.platform === 'win32') throw failure();
    this.started = true;
    const child = this.child = spawn(this.config.command, [...(this.config.args ?? [])], {
      cwd: this.options.cwd, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: COMMAND_PATH, LANG: 'en_US.UTF-8', ...this.config.env },
    });
    child.stdin.on('error', () => this.fail());
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.stopped) return;
      try {
        this.check();
        this.bytes += chunk.length;
        if (this.bytes > SESSION_BYTES) throw failure();
        // SDK ReadBuffer checks bytes BEFORE concatenation/JSON parsing.
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while (!this.stopped && (message = this.buffer.readMessage()) !== null) {
          if (++this.frames > 512) throw failure();
          this.onmessage?.(safeMessage(message));
        }
      } catch { this.fail(); }
    });
    // Never retain/log stderr, including credentials printed by a failed server.
    child.stderr.on('data', (chunk: Buffer) => { this.bytes += chunk.length; if (this.bytes > SESSION_BYTES) this.fail(); });
    child.once('error', () => this.fail());
    child.once('exit', () => { void this.close(); });
    this.options.signal?.addEventListener('abort', this.abort, { once: true });
    this.timer = setTimeout(() => this.fail(), this.options.timeoutMs ?? 30000);
    this.watch = setInterval(() => { try { this.check(); } catch { this.fail(); } }, 100);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => reject(failure()));
      });
      this.check();
    } catch { await this.close(); throw failure(); }
  }
  async send(message: JSONRPCMessage): Promise<void> {
    try {
      this.check();
      const data = serializeMessage(message);
      if (!this.child || Buffer.byteLength(data) > WIRE_BYTES || this.child.stdin.writableLength + Buffer.byteLength(data) > WIRE_BYTES) throw failure();
      await new Promise<void>((resolve, reject) => this.child!.stdin.write(data, error => error ? reject(failure()) : resolve()));
    } catch { await this.close(); throw failure(); }
  }
  close(): Promise<void> {
    if (this.closed) return this.closed;
    this.stopped = true;
    clearTimeout(this.timer); clearInterval(this.watch);
    this.options.signal?.removeEventListener('abort', this.abort);
    this.buffer.clear();
    const child = this.child;
    const kill = (signal: NodeJS.Signals) => {
      if (child?.pid) { try { process.kill(-child.pid, signal); } catch { /* Group already gone. */ } }
    };
    // Always retain escalation after leader/pipe exit: descendants may ignore TERM.
    kill('SIGTERM');
    child?.stdin.destroy(); child?.stdout.destroy(); child?.stderr.destroy();
    this.closed = new Promise(resolve => {
      setTimeout(() => { kill('SIGKILL'); this.onclose?.(); resolve(); }, child ? 250 : 0);
    });
    return this.closed;
  }
}

/** Construct only AFTER the executor's connect approval. No resources/prompts/OAuth. */
export function createDesktopMcpTransport(server: Readonly<ManagedMcpServer>, supplied: DesktopMcpTransportOptions): Transport {
  // Copy explicit values; caller mutation cannot change a previously approved target.
  const options = Object.freeze({ ...supplied });
  if (!isAbsolute(options.cwd) || !Number.isFinite(options.timeoutMs ?? 30000) || (options.timeoutMs ?? 30000) <= 0 || (options.timeoutMs ?? 30000) > 30000) throw failure();
  options.assertCurrent();
  if (options.signal?.aborted || !server.enabled) throw failure();
  const config = JSON.parse(JSON.stringify(server.config)) as ManagedMcpServer['config'];
  if ('command' in config) {
    if (!config.command || typeof config.command !== 'string' || config.command.includes('\0') || (config.args && (!Array.isArray(config.args) || config.args.some(a => typeof a !== 'string' || a.includes('\0'))))) throw failure();
    if (config.env && Object.entries(config.env).some(([key, value]) => !key || key.includes('=') || key.includes('\0') || typeof value !== 'string' || value.includes('\0'))) throw failure();
    return new GroupStdioTransport(config, options);
  }
  if (config.type !== 'http') throw new Error('MCP: Legacy-SSE nicht unterstützt.');
  const url = new URL(config.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw failure();
  const controller = new AbortController();
  let total = 0;
  let requests = 0;
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let watch: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let started = false;
  const check = () => { if (controller.signal.aborted || options.signal?.aborted) throw failure(); options.assertCurrent(); };
  const fetcher: FetchLike = async (input, init) => {
    check();
    if (new URL(String(input)).href !== url.href || ++requests > 128 || (typeof init?.body === 'string' && Buffer.byteLength(init.body) > WIRE_BYTES)) throw failure();
    const deadline = setTimeout(() => { void transport.close(); }, options.timeoutMs ?? 30000);
    timers.add(deadline);
    const finish = () => { clearTimeout(deadline); timers.delete(deadline); };
    try {
      const response = await (options.fetch ?? fetch)(url, { ...init, signal: controller.signal, redirect: 'manual', credentials: 'omit' });
      check();
      // Block ALL redirects before SDK can inspect a Location/auth challenge.
      if ((response.status >= 300 && response.status < 400) || response.redirected || (response.url && response.url !== url.href)) { void response.body?.cancel(); throw failure(); }
      const media = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
      if (!response.ok || response.status === 202 || response.status === 204) {
        void response.body?.cancel(); finish();
        // Do not relay remote error bodies/statusText (may contain credentials).
        if (response.status === 405 && init?.method === 'GET') return new Response(null, { status: 405 });
        if (!response.ok) throw failure();
        return new Response(null, { status: response.status, headers: response.headers });
      }
      if (!response.body || !['application/json', 'text/event-stream'].includes(media ?? '')) { void response.body?.cancel(); throw failure(); }
      const reader = response.body.getReader(); readers.add(reader);
      let bytes = 0;
      // Whole-response cap bounds SDK JSON and SSE parsers, including no-newline input.
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            check();
            const chunk = await reader.read();
            check();
            if (chunk.done) { readers.delete(reader); finish(); stream.close(); return; }
            bytes += chunk.value.byteLength; total += chunk.value.byteLength;
            if (bytes > WIRE_BYTES || total > SESSION_BYTES) throw failure();
            stream.enqueue(chunk.value);
          } catch { void reader.cancel().catch(() => {}); readers.delete(reader); finish(); stream.error(failure()); void transport.close(); }
        },
        cancel() { readers.delete(reader); finish(); return reader.cancel(); },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch { finish(); void transport.close(); throw failure(); }
  };
  const inner = new StreamableHTTPClientTransport(url, { fetch: fetcher, requestInit: { headers: config.headers }, reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 } });
  const abort = () => { void transport.close(); };
  const transport: Transport = {
    async start() {
      check();
      if (started) throw failure();
      started = true;
      options.signal?.addEventListener('abort', abort, { once: true });
      watch = setInterval(() => { try { check(); } catch { void transport.close(); } }, 100);
      inner.onmessage = message => { try { check(); transport.onmessage?.(safeMessage(message)); } catch { void transport.close(); } };
      inner.onerror = () => { transport.onerror?.(failure()); void transport.close(); };
      await inner.start();
    },
    async send(message) {
      try { check(); if (!started) throw failure(); await inner.send(message); }
      catch { await transport.close(); throw failure(); }
    },
    setProtocolVersion(version) { inner.setProtocolVersion(version); },
    async close() {
      if (closed) return;
      closed = true; controller.abort(); clearInterval(watch);
      options.signal?.removeEventListener('abort', abort);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const reader of readers) void reader.cancel().catch(() => {});
      readers.clear();
      await inner.close(); transport.onclose?.();
    },
  };
  return transport;
}
