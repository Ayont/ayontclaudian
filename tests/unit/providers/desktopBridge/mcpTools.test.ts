/** @jest-environment node */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { McpConsent } from '../../../../src/providers/desktopBridge/mcpTools';
import { DesktopMcpSession } from '../../../../src/providers/desktopBridge/mcpTools';

// A 15 ms budget used to cover connect + listTools as well; under full-suite load
// discovery alone overran it and the test failed before reaching the invoke.
const SLOW_SESSION_TIMEOUT_MS = 250;
const SLOW_TOOL_MS = 1000;

async function fixture(approve: (request: Readonly<McpConsent>) => Promise<boolean> = async () => true, slow = false) {
  const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
  let calls = 0;
  let allowed = true;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', inputSchema: schema }] }));
  server.setRequestHandler(CallToolRequestSchema, async req => {
    calls++;
    // The session budget bounds connect and discovery too, so only the tool call
    // may be slow: it has to outlast the budget while discovery stays well inside it.
    if (slow) await new Promise(resolve => setTimeout(resolve, SLOW_TOOL_MS));
    return { content: [{ type: 'text', text: String(req.params?.arguments?.text) }], isError: req.params?.arguments?.text === 'error' };
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const close = jest.spyOn(a, 'close');
  const factory = jest.fn(() => a);
  const session = new DesktopMcpSession({ enabled: true, servers: [{ name: 'fixture', config: { command: '/not-started', env: { PRIVATE_TOKEN: 'synthetic-secret' } }, enabled: true, contextSaving: false }], selectedNames: [], stillAllowed: () => allowed, approve, transportFactory: factory, timeoutMs: slow ? SLOW_SESSION_TIMEOUT_MS : 1000 });
  const [entry] = await session.catalog();
  return { server, session, entry, factory, close, calls: () => calls, revoke: () => { allowed = false; }, cleanup: async () => { await session.dispose(); await server.close(); } };
}

const schema = { type: 'object' as const, properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };

test('real SDK initializes, lists cursor pages, invokes once and discloses exact result', async () => {
  const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
  let calls = 0;
  server.setRequestHandler(ListToolsRequestSchema, async req => ({ tools: [{ name: req.params?.cursor ? 'second' : 'echo', inputSchema: schema }], ...(!req.params?.cursor ? { nextCursor: 'second' } : {}) }));
  server.setRequestHandler(CallToolRequestSchema, async req => { calls++; return { content: [{ type: 'text', text: String(req.params?.arguments?.text) }] }; });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const session = new DesktopMcpSession({ enabled: true, servers: [{ name: 'fixture', config: { command: '/synthetic/not-started' }, enabled: true, contextSaving: false }], selectedNames: [], stillAllowed: () => true, approve: async () => true, transportFactory: () => clientTransport });
  try {
    const servers = await session.catalog();
    const tools = await session.discover(servers[0].serverId);
    expect(tools).toHaveLength(2);
    const result = await session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: session.nonce, capabilityId: tools[0].capabilityId, args: { text: 'harmless fixture' } }));
    expect(result).toContain('harmless fixture');
    expect(calls).toBe(1);
  } finally { await session.dispose(); await server.close(); }
});

test('synchronous abort inside approval rejects promptly rather than missing the abort event', async () => {
  const controller = new AbortController();
  const session = new DesktopMcpSession({enabled:true,servers:[],selectedNames:[],stillAllowed:()=>true,signal:controller.signal,timeoutMs:1000,approve:()=>{controller.abort();return new Promise(()=>{});}});
  const operation = session.catalog().then(()=>'unexpected', ()=>'closed');
  try {
    expect(await Promise.race([operation,new Promise(resolve=>setTimeout(()=>resolve('pending'),100))])).toBe('closed');
  } finally { await session.dispose(); await operation; }
});

test('default off rejects before catalog approval or transport construction', async () => {
  const approve = jest.fn();
  const transportFactory = jest.fn();
  const session = new DesktopMcpSession({ servers: [], selectedNames: [], stillAllowed: () => true, approve, transportFactory });
  await expect(session.catalog()).rejects.toThrow();
  expect(approve).not.toHaveBeenCalled();
  expect(transportFactory).not.toHaveBeenCalled();
});

test('connect denial causes zero transport construction', async () => {
  const f = await fixture(async request => request.kind !== 'connect');
  try {
    await expect(f.session.discover(f.entry.serverId)).rejects.toThrow('abgelehnt');
    expect(f.factory).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
});

test.each(['prose', '{}', '{"mcp_tool":"invoke","nonce":"stale","capabilityId":"fake","args":{}}'])('rejects malformed or stale proposal %s', async text => {
  const f = await fixture();
  try { await expect(f.session.execute(text)).rejects.toThrow(); expect(f.calls()).toBe(0); }
  finally { await f.cleanup(); }
});

test.each([{ text: 4 }, { text: 'ok', extra: true }])('validates exact arguments before consent: %j', async args => {
  const approve = jest.fn(async () => true);
  const f = await fixture(approve);
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    approve.mockClear();
    await expect(f.session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: f.session.nonce, capabilityId: tool.capabilityId, args }))).rejects.toThrow('Schema');
    expect(approve).not.toHaveBeenCalled();
    expect(f.calls()).toBe(0);
  } finally { await f.cleanup(); }
});

test('revocation during invocation approval blocks dispatch', async () => {
  const f = await fixture(async req => { if (req.kind === 'invoke') f.revoke(); return true; });
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    await expect(f.session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: f.session.nonce, capabilityId: tool.capabilityId, args: { text: 'ok' } }))).rejects.toThrow();
    expect(f.calls()).toBe(0);
  } finally { await f.cleanup(); }
});

test('result revocation suppresses disclosure and continuation guard', async () => {
  const f = await fixture(async req => { if (req.kind === 'result') f.revoke(); return true; });
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    await expect(f.session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: f.session.nonce, capabilityId: tool.capabilityId, args: { text: 'ok' } }))).rejects.toThrow();
    expect(f.calls()).toBe(1);
    expect(() => f.session.assertCurrent()).toThrow();
  } finally { await f.cleanup(); }
});

test('real SDK timeout closes once with no retry', async () => {
  const clientClose = jest.spyOn(Client.prototype, 'close');
  const f = await fixture(async () => true, true);
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    await expect(f.session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: f.session.nonce, capabilityId: tool.capabilityId, args: { text: 'ok' } }))).rejects.toThrow('unbekannt');
    await f.session.dispose();
    expect(f.calls()).toBe(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
    // Linked SDK transports recurse close into their peer, so transport.close itself runs twice.
    expect(f.close).toHaveBeenCalledTimes(2);
  } finally { await f.cleanup(); clientClose.mockRestore(); }
});

test('known configured credentials are scrubbed from tool error consent and output', async () => {
  const requests: Readonly<McpConsent>[] = [];
  const f = await fixture(async req => { requests.push(req); return true; });
  f.server.setRequestHandler(CallToolRequestSchema, async () => ({content:[{type:'text',text:'failure: synthetic-secret'}],structuredContent:{nested:'synthetic-secret'},isError:true}));
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    const result = await f.session.execute(JSON.stringify({mcp_tool:'invoke',nonce:f.session.nonce,capabilityId:tool.capabilityId,args:{text:'ok'}}));
    expect(result).not.toContain('synthetic-secret');
    expect(JSON.stringify(requests)).not.toContain('synthetic-secret');
    expect(result).toContain('[REDACTED]');
  } finally { await f.cleanup(); }
});

test('tool errors are outcomes; stale nonce cannot replay and credentials stay out of consent', async () => {
  const requests: Readonly<McpConsent>[] = [];
  const f = await fixture(async req => { requests.push(req); return true; });
  try {
    const [tool] = await f.session.discover(f.entry.serverId);
    const proposal = JSON.stringify({ mcp_tool: 'invoke', nonce: f.session.nonce, capabilityId: tool.capabilityId, args: { text: 'error' } });
    const page = JSON.parse(await f.session.execute(proposal));
    expect(JSON.parse(page.text).isError).toBe(true);
    await expect(f.session.execute(proposal)).rejects.toThrow();
    expect(f.calls()).toBe(1);
    expect(JSON.stringify(requests)).not.toContain('synthetic-secret');
    expect(JSON.stringify(requests)).toContain('PRIVATE_TOKEN');
  } finally { await f.cleanup(); }
});

