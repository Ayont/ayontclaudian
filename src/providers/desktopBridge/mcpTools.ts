import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { createHash, randomUUID } from 'crypto';
import { clearTimeout, setTimeout } from 'timers';

import type { ManagedMcpServer } from '../../core/types/mcp';

export interface McpConsent {
  kind: 'catalog' | 'connect' | 'metadata' | 'invoke' | 'result';
  /** Exact disclosure, never raw configuration, headers or environment values. */
  text: string;
}
export interface DesktopMcpOptions {
  enabled?: boolean;
  servers: readonly ManagedMcpServer[];
  selectedNames: readonly string[];
  /** Must compare configuration generation, provider binding and current permissions. */
  stillAllowed: () => boolean;
  approve: (request: Readonly<McpConsent>, signal: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Trusted host cwd, disclosed in connect consent; never supplied by model text. */
  transportWorkingDirectory?: string;
  /** Trusted host injection only; bind context guard/signal into production transports. */
  transportFactory?: (server: Readonly<ManagedMcpServer>, context: { assertCurrent: () => void; signal: AbortSignal }) => Transport;
}
interface Capability {
  serverId: string;
  name: string;
  schema: Record<string, unknown>;
  hash: string;
}

function snapshot<T>(value: T, budget = 65536): T {
  const encoded = JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > budget) throw new Error('MCP: JSON-Limit überschritten.');
  const copy = JSON.parse(encoded);
  let count = 0;
  function freeze(v: unknown, depth: number): void {
    if (++count > 4096 || depth > 24) throw new Error('MCP: JSON-Struktur zu komplex.');
    if (v && typeof v === 'object') {
      for (const [key, child] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('MCP: Ungültiger JSON-Schlüssel.');
        freeze(child, depth + 1);
      }
      Object.freeze(v);
    }
  }
  freeze(copy, 0);
  return copy;
}
function schemaCheck(schema: Record<string, unknown>): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      // No external resolution or unbounded recursive schema compilation.
      if (['$ref', '$dynamicRef', '$recursiveRef'].includes(key)) throw new Error('MCP: Schema-Verweise nicht unterstützt.');
      visit(child);
    }
  };
  visit(schema);
}

/** Tools-only SDK executor. Not registered with desktop runtimes until UI/transport gates are complete. */
export class DesktopMcpSession {
  private readonly controller = new AbortController();
  private readonly servers = new Map<string, ManagedMcpServer>();
  private readonly clients = new Map<string, Client>();
  private readonly capabilities = new Map<string, Capability>();
  private readonly pages = new Map<string, string>();
  private readonly validator = new AjvJsonSchemaValidator();
  private disposed?: Promise<void>;
  private busy = false;
  private actions = 0;
  private currentNonce = randomUUID();
  private readonly onAbort = () => { void this.dispose(); };

  constructor(private readonly options: DesktopMcpOptions) {
    if (options.enabled === true) {
      for (const server of options.servers) {
        if (server.enabled && (!server.contextSaving || options.selectedNames.includes(server.name))) {
          if (this.servers.size >= 16) throw new Error('MCP: Zu viele Server.');
          this.servers.set(randomUUID(), snapshot(server));
        }
      }
    }
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
  }
  get nonce(): string { return this.currentNonce; }
  private check(): void {
    if (this.options.enabled !== true || this.controller.signal.aborted || this.options.signal?.aborted || !this.options.stillAllowed()) {
      void this.dispose();
      throw new Error('MCP: Berechtigung widerrufen oder nicht aktiviert.');
    }
  }
  private async consent(kind: McpConsent['kind'], text: string): Promise<void> {
    this.check();
    const approved = await this.bounded(() => this.options.approve(Object.freeze({ kind, text }), this.controller.signal));
    this.check();
    if (approved !== true) { await this.dispose(); throw new Error('MCP: Abgelehnt.'); }
  }
  private async bounded<T>(run: () => Promise<T>): Promise<T> {
    this.check();
    const signal = this.controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: () => void = () => {};
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new Error('MCP: Abgebrochen; Ausführungsstatus gegebenenfalls unbekannt.'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => { void this.dispose(); reject(new Error('MCP: Zeitlimit; Status unbekannt. Keine automatische Wiederholung.')); }, Math.min(this.options.timeoutMs ?? 30000, 30000));
      });
      // Install cancellation before invoking host callbacks, which can abort synchronously.
      const result = await Promise.race([interrupted, Promise.resolve().then(() => { this.check(); return run(); })]);
      this.check();
      return result;
    } catch {
      await this.dispose();
      throw new Error('MCP: Vorgang beendet. Status gegebenenfalls unbekannt; Authentifizierung ohne sichere Oberfläche nicht unterstützt. Keine automatische Wiederholung.');
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  async catalog(): Promise<Array<{ serverId: string; name: string }>> {
    this.check();
    const list = [...this.servers].map(([serverId, server]) => ({ serverId, name: server.name }));
    await this.consent('catalog', JSON.stringify(list));
    return list;
  }
  async discover(serverId: string): Promise<Array<{ capabilityId: string; name: string; schema: Record<string, unknown>; hash: string }>> {
    this.check();
    if (this.busy || this.clients.has(serverId) || ++this.actions > 30) throw new Error('MCP: Vorgang nicht zulässig.');
    const server = this.servers.get(serverId);
    if (!server) throw new Error('MCP: Unbekannter Server.');
    this.busy = true;
    try {
      const config = server.config;
      let target: unknown;
      if ('command' in config) {
        target = { executable: config.command, args: config.args ?? [], cwd: this.options.transportWorkingDirectory, environmentKeys: Object.keys(config.env ?? {}), risk: 'Beliebige Host-/Netzwerkzugriffe; keine Sandbox.' };
      } else {
        const url = new URL(config.url);
        if (url.username || url.password || url.hash || url.search || !['https:', 'http:'].includes(url.protocol)) throw new Error('MCP: Nicht unterstützte Server-URL.');
        target = { origin: url.origin, risk: 'Netzwerkzugriff; konfigurierte Zugangsdaten bleiben lokal. Interaktives OAuth nicht unterstützt.' };
      }
      await this.consent('connect', JSON.stringify({ server: server.name, target, timeoutMs: Math.min(this.options.timeoutMs ?? 30000, 30000) }));
      this.check();
      // Host must bind the approved working directory and this session's live guard.
      // No implicit transport/configuration fallback before runtime integration review.
      if (!this.options.transportFactory) throw new Error('MCP: Gehärteter Transport noch nicht verfügbar.');
      const client = new Client({ name: 'claudian-desktop-mcp', version: '1' }, { capabilities: {} });
      this.clients.set(serverId, client);
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await this.dispose(); });
      const transport = this.options.transportFactory(server, { assertCurrent: () => this.check(), signal: this.controller.signal });
      await this.bounded(() => client.connect(transport, { signal: this.controller.signal, timeout: 10000 }));
      if (!client.getServerCapabilities()?.tools) throw new Error('MCP: Server unterstützt keine Tools.');
      let cursor: string | undefined;
      const seen = new Set<string>();
      const names = new Set<string>();
      const metadata = [];
      let bytes = 0;
      for (let page = 0; page < 16; page++) {
        const result = snapshot(await this.bounded(() => client.listTools(cursor ? { cursor } : undefined, { signal: this.controller.signal, timeout: 10000 })), 131072);
        bytes += Buffer.byteLength(JSON.stringify(result));
        if (bytes > 131072) throw new Error('MCP: Katalog-Limit überschritten.');
        for (const tool of result.tools) {
          if (names.has(tool.name) || names.size >= 128) throw new Error('MCP: Ungültiger Tool-Katalog.');
          names.add(tool.name);
          if (server.disabledTools?.some(name => name.trim() === tool.name)) continue;
          const schema = snapshot(tool.inputSchema, 16384);
          schemaCheck(schema);
          this.validator.getValidator(schema);
          const hash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
          const capabilityId = randomUUID();
          this.capabilities.set(capabilityId, { serverId, name: tool.name, schema, hash });
          metadata.push({ capabilityId, name: tool.name, schema, hash });
        }
        cursor = result.nextCursor;
        if (!cursor) break;
        if (seen.has(cursor) || page === 15) throw new Error('MCP: Cursor-/Seitenlimit überschritten.');
        seen.add(cursor);
      }
      await this.consent('metadata', JSON.stringify(metadata));
      return metadata;
    } catch { await this.dispose(); throw new Error('MCP: Discovery beendet; keine Wiederholung. Transport/Auth/Schema nicht unterstützt oder Zustimmung abgelehnt.'); }
    finally { this.busy = false; }
  }
  async execute(text: string, framingUnits = 600): Promise<string> {
    this.check();
    if (this.busy || ++this.actions > 30 || !Number.isInteger(framingUnits) || framingUnits < 0 || framingUnits > 1500) throw new Error('MCP: Aktions-/Rahmenlimit.');
    if (Buffer.byteLength(text) > 32768) throw new Error('MCP: Anfrage zu groß.');
    const request = snapshot(JSON.parse(text)) as Record<string, unknown>;
    if (!request || Array.isArray(request) || typeof request !== 'object' || request.nonce !== this.currentNonce) throw new Error('MCP: Ungültige Anfrage/Nonce.');
    const keys = request.mcp_tool === 'invoke' ? ['mcp_tool', 'nonce', 'capabilityId', 'args'] : request.mcp_tool === 'page' ? ['mcp_tool', 'nonce', 'pageId'] : [];
    if (Object.keys(request).length !== keys.length || Object.keys(request).some(key => !keys.includes(key))) throw new Error('MCP: Ungültiges Schema.');
    this.currentNonce = randomUUID();
    this.busy = true;
    try {
      if (request.mcp_tool === 'page') {
        const page = this.pages.get(String(request.pageId));
        if (!page || page.length + framingUnits > 2000) throw new Error('MCP: Ungültige Seite/Rahmenbudget.');
        await this.consent('result', page);
        return page;
      }
      const capability = this.capabilities.get(String(request.capabilityId));
      if (!capability || !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new Error('MCP: Unbekanntes Tool/Argumente.');
      const validate = this.validator.getValidator(capability.schema);
      if (!validate(request.args).valid) throw new Error('MCP: Argumente entsprechen nicht dem Schema.');
      await this.consent('invoke', JSON.stringify({ server: this.servers.get(capability.serverId)!.name, tool: capability.name, hash: capability.hash, args: request.args, risk: 'Einmal ausführen; Nebenwirkungen möglich.' }));
      this.check();
      const result = snapshot(await this.bounded(() => this.clients.get(capability.serverId)!.callTool({ name: capability.name, arguments: request.args as Record<string, unknown> }, undefined, { signal: this.controller.signal, timeout: Math.min(this.options.timeoutMs ?? 30000, 30000) })), 65536);
      const content = result.content;
      if (!Array.isArray(content) || content.length > 64 || content.some(block => block.type !== 'text')) throw new Error('MCP: Nicht-Text-Inhalte werden nicht übertragen. Tool wurde ausgeführt.');
      let output = JSON.stringify({ content: content.map(block => ({ type: 'text', text: block.text })), structuredContent: result.structuredContent, isError: result.isError === true });
      if (result.isError === true) {
        // Only known configured values, not arbitrary secrets in remote content.
        const config = this.servers.get(capability.serverId)!.config;
        const values = Object.values('command' in config ? config.env ?? {} : config.headers ?? {});
        const secrets = values.flatMap(value => [value, ...(/^Bearer\s+/i.test(value) ? [value.replace(/^Bearer\s+/i, '')] : [])]);
        const ordered = secrets.filter(Boolean).sort((a, b) => b.length - a.length);
        output = JSON.stringify(JSON.parse(output, (_key, value: unknown) => {
          if (typeof value !== 'string') return value;
          for (const secret of ordered) value = (value as string).split(secret).join('[REDACTED]');
          return value;
        }));
      }
      const points = Array.from(output);
      const segments: string[] = [];
      let part = '';
      for (const point of points) {
        if (JSON.stringify({ text: part + point }).length > 2000 - framingUnits - 200) { segments.push(part); part = ''; }
        part += point;
      }
      segments.push(part);
      if (this.pages.size + segments.length > 256) throw new Error('MCP: Ergebnisspeicher voll.');
      const ids = segments.map(() => randomUUID());
      segments.forEach((segment, index) => this.pages.set(ids[index], JSON.stringify({ text: segment, nextPageId: ids[index + 1] ?? null, totalUnits: output.length, partial: segments.length > 1 })));
      if ([...this.pages.values()].reduce((bytes, page) => bytes + Buffer.byteLength(page), 0) > 131072) {
        await this.dispose();
        throw new Error('MCP: Ergebnisspeicher-Limit überschritten.');
      }
      const first = this.pages.get(ids[0])!;
      if (first.length + framingUnits > 2000) throw new Error('MCP: Rahmenbudget überschritten.');
      await this.consent('result', first);
      return first;
    } finally { this.busy = false; }
  }
  /** Call on configuration/binding changes and before any outgoing continuation. */
  assertCurrent(): void { this.check(); }
  dispose(): Promise<void> {
    if (this.disposed) return this.disposed;
    this.controller.abort();
    this.options.signal?.removeEventListener('abort', this.onAbort);
    this.capabilities.clear();
    this.pages.clear();
    this.servers.clear();
    this.disposed = Promise.allSettled([...this.clients.values()].map(client => client.close())).then(() => {});
    this.clients.clear();
    return this.disposed;
  }
}
