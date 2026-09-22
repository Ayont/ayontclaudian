/** @jest-environment node */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { DesktopMcpSession } from '../../../../src/providers/desktopBridge/mcpTools';
import { createDesktopMcpTransport } from '../../../../src/providers/desktopBridge/mcpTransports';

const fixture = `
const readline = require('readline');
setTimeout(() => process.exit(0), 5000).unref();
readline.createInterface({ input: process.stdin }).on('line', line => {
 const m = JSON.parse(line); if (m.id === undefined) return;
 const result = m.method === 'initialize' ? { protocolVersion:'2025-03-26', capabilities:{tools:{}}, serverInfo:{name:'fixture',version:'1'} } : m.method === 'tools/list' ? {tools:[{name:'echo',inputSchema:{type:'object'}}]} : {content:[{type:'text',text:'fixture-ok'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
});`;

test('real subprocess initializes, lists and invokes through SDK then closes', async () => {
  const transport = createDesktopMcpTransport({ name: 'fixture', enabled: true, contextSaving: false, config: { command: process.execPath, args: ['-e', fixture] } }, { cwd: process.cwd(), assertCurrent: () => {} });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools[0].name).toBe('echo');
    expect(await client.callTool({ name: 'echo', arguments: {} })).toEqual({ content: [{ type: 'text', text: 'fixture-ok' }] });
  } finally { await client.close(); }
});

test('shared executor consents before real transport, invokes once, and forwards live guard', async () => {
  const cwd = process.cwd(); let allowed = true;
  const approvals: string[] = [];
  const connectConstructionCounts: number[] = [];
  const factory = jest.fn((server, context) => createDesktopMcpTransport(server, { cwd, ...context }));
  const session = new DesktopMcpSession({ enabled: true, selectedNames: [], servers: [{ name: 'fixture', enabled: true, contextSaving: false, config: { command: process.execPath, args: ['-e', fixture] } }], transportWorkingDirectory: cwd, stillAllowed: () => allowed, transportFactory: factory, approve: async request => { if (request.kind === 'connect') connectConstructionCounts.push(factory.mock.calls.length); approvals.push(request.text); return true; } });
  try {
    const [server] = await session.catalog();
    const [tool] = await session.discover(server.serverId);
    expect(await session.execute(JSON.stringify({ mcp_tool: 'invoke', nonce: session.nonce, capabilityId: tool.capabilityId, args: {} }))).toContain('fixture-ok');
    expect(approvals.some(text => text.includes(cwd))).toBe(true);
    expect(connectConstructionCounts).toEqual([0]);
    allowed = false;
    expect(factory.mock.calls[0][1].assertCurrent).toThrow();
    expect(factory.mock.calls[0][1].signal.aborted).toBe(true);
  } finally { await session.dispose(); }
});

function stdio(script: string, extra: Partial<Parameters<typeof createDesktopMcpTransport>[1]> = {}) {
  return createDesktopMcpTransport({ name: 'fixture', enabled: true, contextSaving: false, config: { command: process.execPath, args: ['-e', script] } }, { cwd: process.cwd(), assertCurrent: () => {}, ...extra });
}

test('stdio start rejects missing executable instead of reporting a running transport', async () => {
  const transport = createDesktopMcpTransport({name:'missing',enabled:true,contextSaving:false,config:{command:'/nonexistent/claudian-mcp-fixture'}}, {cwd:process.cwd(),assertCurrent:()=>{}});
  const closed = jest.fn(); transport.onclose = closed;
  try { await expect(transport.start()).rejects.toThrow('Transport'); }
  finally { await transport.close(); }
  expect(closed).toHaveBeenCalledTimes(1);
});

test.each(['process.stdout.write("x".repeat(200000))', 'process.stdout.write("not-json\\n")', 'process.stderr.write("x".repeat(2200000))'])('bounded malformed subprocess output closes: %s', async script => {
  const transport = stdio(script);
  const error = jest.fn(); transport.onerror = error;
  const closed = new Promise<void>(resolve => { transport.onclose = resolve; });
  await transport.start(); await closed;
  expect(error).toHaveBeenCalled();
  await transport.close();
});

test.each(['abort', 'timeout', 'leader-exit'])('process-group cleanup includes TERM-ignoring descendants: %s', async mode => {
  const controller = new AbortController();
  const script = `const {spawn}=require('child_process');
  const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>process.exit(0),4000);setInterval(()=>{},100)"],{stdio:'ignore'});
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'fixture',params:{pid:c.pid}})+'\\n');
  ${mode === 'leader-exit' ? 'setTimeout(()=>process.exit(0),100)' : 'setInterval(()=>{},100);setTimeout(()=>process.exit(0),4000)'};`;
  const transport = stdio(script, { signal: controller.signal, timeoutMs: mode === 'timeout' ? 350 : 2000 });
  let pid = 0;
  const received = new Promise<void>(resolve => { transport.onmessage = message => { pid = (message as unknown as {params:{pid:number}}).params.pid; resolve(); }; });
  const closed = new Promise<void>(resolve => { transport.onclose = resolve; });
  try {
    await transport.start(); await received;
    if (mode === 'abort') controller.abort();
    await closed;
    // Reaping can follow delivery of KILL. The bound stays under the descendant's
    // own 4s expiry so a pass still proves the group cleanup killed it, and it is
    // wide enough that a loaded machine running the full suite does not flake.
    for (let i=0; i<125; i++) {
      try { process.kill(pid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { await transport.close(); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already reaped. */ } } }
}, 15000);

function http(fetcher: NonNullable<Parameters<typeof createDesktopMcpTransport>[1]['fetch']>, extra: Partial<Parameters<typeof createDesktopMcpTransport>[1]> = {}) {
  return createDesktopMcpTransport({ name: 'fixture', enabled: true, contextSaving: false, config: { type: 'http', url: 'http://127.0.0.1:1/mcp', headers: { Authorization: 'Bearer synthetic' } } }, { cwd: process.cwd(), assertCurrent: () => {}, fetch: fetcher, ...extra });
}

test('HTTP mock fetch exercises real SDK initialize/list/call, static credentials only to approved URL', async () => {
  const calls: Array<{url:string; init?:RequestInit}> = [];
  const transport = http(async (url, init) => {
    calls.push({url:String(url),init});
    if (init?.method === 'GET') return new Response(null,{status:405});
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null,{status:202});
    const result = message.method === 'initialize' ? {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}} : message.method === 'tools/list' ? {tools:[]} : {content:[{type:'text',text:'ok'}]};
    return Response.json({jsonrpc:'2.0',id:message.id,result});
  });
  const client = new Client({name:'test',version:'1'});
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toEqual([]);
    expect(await client.callTool({name:'echo',arguments:{}})).toEqual({content:[{type:'text',text:'ok'}]});
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) {
      expect(call.url).toBe('http://127.0.0.1:1/mcp');
      expect(call.init?.redirect).toBe('manual');
      expect(call.init?.credentials).toBe('omit');
      expect(new Headers(call.init?.headers).get('authorization')).toBe('Bearer synthetic');
    }
  } finally { await client.close(); }
});

test.each([302,401,403])('HTTP blocks redirect/auth %s without retry or body disclosure', async status => {
  const fetcher = jest.fn(async () => new Response('secret remote body',{status,headers:{Location:'https://other.invalid/'}}));
  const transport = http(fetcher);
  try {
    await transport.start();
    await expect(transport.send({jsonrpc:'2.0',id:1,method:'initialize'})).rejects.toThrow('Transport');
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { await transport.close(); }
});

test.each(['application/json','text/event-stream','text/html'])('HTTP bounds/rejects ingress %s before SDK allocation', async media => {
  const cancel = jest.fn();
  const transport = http(async () => new Response(new ReadableStream({start(c) { c.enqueue(new Uint8Array(140000)); },cancel}), {headers:{'content-type':media}}));
  const closed = new Promise<void>(resolve => { transport.onclose=resolve; });
  try {
    await transport.start();
    await transport.send({jsonrpc:'2.0',id:1,method:'initialize'}).catch(() => {});
    await closed;
    expect(cancel).toHaveBeenCalled();
  } finally { await transport.close(); }
});

test.each(['stdio', 'http'])('idle revocation rejects pending SDK initialization: %s', async mode => {
  let allowed = true;
  const assertCurrent = () => { if (!allowed) throw new Error('revoked'); };
  const transport = mode === 'stdio'
    ? stdio('setTimeout(()=>process.exit(0),3000)', {assertCurrent})
    : http(async () => new Response(new ReadableStream({start() { /* Await cancellation. */ }}), {headers:{'content-type':'application/json'}}), {assertCurrent});
  const client = new Client({name:'test',version:'1'});
  const pending = client.connect(transport).then(()=>'connected', ()=>'closed');
  await new Promise(resolve=>setTimeout(resolve,30));
  allowed = false;
  try {
    expect(await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve('pending'),1000))])).toBe('closed');
  } finally { await client.close(); }
});

test('abort during subprocess spawn setup rejects start and is idempotently closed', async () => {
  const controller = new AbortController();
  const transport = stdio('setTimeout(()=>process.exit(0),3000)',{signal:controller.signal});
  const closed = jest.fn(); transport.onclose = closed;
  const pending = transport.start(); controller.abort();
  await expect(pending).rejects.toThrow('Transport');
  await Promise.all([transport.close(),transport.close()]);
  expect(closed).toHaveBeenCalledTimes(1);
});

test.each(['stdio', 'http'])('protocol errors cannot echo configured credentials through SDK: %s', async mode => {
  const transport = mode === 'stdio'
    ? stdio(`require('readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32603,message:'Bearer synthetic',data:{token:'synthetic'}}})+'\\n');});setTimeout(()=>process.exit(0),3000).unref();`)
    : http(async (_url, init) => Response.json({jsonrpc:'2.0',id:JSON.parse(String(init?.body)).id,error:{code:-32603,message:'Bearer synthetic',data:{token:'synthetic'}}}));
  const client = new Client({name:'test',version:'1'});
  try {
    const error = await client.connect(transport).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('synthetic');
    expect(JSON.stringify(error)).not.toContain('synthetic');
  } finally { await client.close(); }
});

test('revocation blocks every HTTP egress even after start', async () => {
  let allowed = true; const fetcher = jest.fn();
  const transport = http(fetcher,{assertCurrent:()=>{if(!allowed) throw new Error('revoked');}});
  try { await transport.start(); allowed=false; await expect(transport.send({jsonrpc:'2.0',method:'notifications/initialized'})).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); }
  finally { await transport.close(); }
});
