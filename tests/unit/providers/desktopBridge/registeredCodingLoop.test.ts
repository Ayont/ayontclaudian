import * as fs from 'fs';
import * as path from 'path';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type ClaudianPlugin from '@/main';
import { queryDesktopBridge } from '@/providers/desktopBridge/DesktopBridgeTransport';
import { desktopRegistration } from '@/providers/desktopBridge/registration';
import { getDesktopSettings, updateDesktopSettings } from '@/providers/desktopBridge/settings';

jest.mock('@/providers/desktopBridge/DesktopBridgeTransport', () => ({ queryDesktopBridge: jest.fn(), desktopBridgeProviders: [{ id: 'grok-bot', displayName: 'Grok' }, { id: 'perplexity-chat', displayName: 'Perplexity' }] }));
jest.mock('@/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/fake', desktopAppPath: () => '/Applications/Fake.app' }));

const ids = ['grok-bot', 'perplexity-chat'] as const;
describe.each(ids)('registered coding loop %s', id => {
  let root: string;
  let plugin: ClaudianPlugin;
  beforeEach(() => {
    jest.clearAllMocks();
    root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'registered-coding-')));
    plugin = { settings: {}, saveSettings: jest.fn().mockResolvedValue(undefined) } as unknown as ClaudianPlugin;
    updateDesktopSettings(plugin.settings, id, { enabled: true, anchor: 'synthetic', localTools: true, commandExecution: true, toolRoot: root });
    ProviderRegistry.register(id, desktopRegistration(id));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const proposal = (prompt: string, fields: object) => JSON.stringify({ nonce: prompt.match(/"nonce":"([^"]+)"/)![1], ...fields });
  it('returns real nonzero output then obtains fresh consent for correction and rerun', async () => {
    fs.writeFileSync(path.join(root, 'sum.cjs'), 'module.exports=(a,b)=>a-b;');
    fs.writeFileSync(path.join(root, 'test.cjs'), 'require("node:assert/strict").equal(require("./sum.cjs")(2,3),5);console.log("PASS_FIXTURE");');
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    const consent = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(consent);
    const run = { local_tool: 'run', path: '.', command: 'node', args: ['test.cjs'] };
    jest.mocked(queryDesktopBridge)
      .mockImplementationOnce(async r => proposal(r.prompt, run))
      .mockImplementationOnce(async r => { expect(r.prompt).toContain('"exitCode":1'); return proposal(r.prompt, { local_tool: 'write', path: 'sum.cjs', content: 'module.exports=(a,b)=>a+b;' }); })
      .mockImplementationOnce(async r => proposal(r.prompt, run))
      .mockImplementationOnce(async r => { expect(r.prompt).toContain('"exitCode":0'); expect(r.prompt).toContain('PASS_FIXTURE'); return 'verified'; });
    const chunks = []; for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Fix the synthetic sum and test it.' }))) chunks.push(chunk);
    expect(consent).toHaveBeenCalledTimes(3);
    expect(new Set(consent.mock.calls.map(c => c[1].nonce)).size).toBe(3);
    expect(consent.mock.calls[0][2]).toContain('HOST EXECUTION — NOT SANDBOX');
    expect(consent.mock.calls[0][1]).toMatchObject({ working_directory: root, args: ['test.cjs'] });
    expect(chunks.filter(c => c.type === 'error')).toEqual([]);
    expect(chunks).toContainEqual({ type: 'text', content: 'verified' });
    for (const [request] of jest.mocked(queryDesktopBridge).mock.calls) expect(request.prompt.length).toBeLessThanOrEqual(2000);
  });
  it.each(['running', 'after-result'] as const)('blocks continuation when command permission is revoked %s', async phase => {
    fs.writeFileSync(path.join(root, 'test.cjs'), 'console.log("STARTED");setTimeout(()=>{},1000);');
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    runtime.setApprovalCallback(async () => {
      if (phase === 'running') setTimeout(() => updateDesktopSettings(plugin.settings, id, { commandExecution: false }), 100);
      return 'allow';
    });
    jest.mocked(queryDesktopBridge)
      .mockImplementationOnce(async r => proposal(r.prompt, { local_tool: 'run', path: '.', command: 'node', args: ['test.cjs'] }))
      .mockResolvedValue('must not send');
    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'test' }))) {
      chunks.push(chunk);
      if (phase === 'after-result' && chunk.type === 'tool_result') updateDesktopSettings(plugin.settings, id, { commandExecution: false });
    }
    expect(chunks.some(c => c.type === 'tool_result')).toBe(true);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it('continues file-only tools with command permission disabled', async () => {
    updateDesktopSettings(plugin.settings, id, { commandExecution: false });
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    runtime.setApprovalCallback(async () => 'allow');
    jest.mocked(queryDesktopBridge)
      .mockImplementationOnce(async r => proposal(r.prompt, { local_tool: 'list', path: '.' }))
      .mockResolvedValueOnce('file-only verified');
    const chunks = []; for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'test' }))) chunks.push(chunk);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
    expect(chunks).toContainEqual({ type: 'text', content: 'file-only verified' });
  });
  it('stops at the action budget before requesting additional consent', async () => {
    updateDesktopSettings(plugin.settings, id, { maxToolActions: 1 });
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    const consent = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(consent);
    jest.mocked(queryDesktopBridge).mockImplementation(async r => proposal(r.prompt, { local_tool: 'list', path: '.' }));
    const chunks = []; for await (const c of runtime.query(runtime.prepareTurn({ text: 'test' }))) chunks.push(c);
    expect(consent).toHaveBeenCalledTimes(1);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'error', content: expect.stringContaining('Limit: 1') }));
  });
  it.each(['cancel', 'revoke'] as const)('blocks a waiting command on %s', async action => {
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    runtime.setApprovalCallback(async () => {
      if (action === 'cancel') runtime.cancel();
      else updateDesktopSettings(plugin.settings, id, { commandExecution: false });
      return 'allow';
    });
    jest.mocked(queryDesktopBridge).mockImplementationOnce(async r => proposal(r.prompt, { local_tool: 'run', path: '.', command: 'node', args: ['-e', 'require("fs").writeFileSync("marker","bad")'] }));
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'test' }))) { expect(chunk.type).toBeDefined(); }
    expect(fs.existsSync(path.join(root, 'marker'))).toBe(false);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it.each(['Please execute node test.cjs', '{"local_tool":"run","nonce":"stale","path":".","command":"node","args":[]}'])('does not execute prose or stale proposals: %s', async reply => {
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    const consent = jest.fn(); runtime.setApprovalCallback(consent);
    jest.mocked(queryDesktopBridge).mockResolvedValueOnce(reply);
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'test' }))) { expect(chunk.type).toBeDefined(); }
    expect(consent).not.toHaveBeenCalled();
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it('denies without unexpected-error event or follow-up send', async () => {
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    runtime.setApprovalCallback(async () => 'deny');
    jest.mocked(queryDesktopBridge).mockImplementationOnce(async r => proposal(r.prompt, { local_tool: 'write', path: 'denied.txt', content: 'no' }));
    const chunks = []; for await (const c of runtime.query(runtime.prepareTurn({ text: 'test' }))) chunks.push(c);
    expect(chunks.some(c => c.type === 'error')).toBe(false);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text', content: expect.stringContaining('abgelehnt') }));
    expect(fs.existsSync(path.join(root, 'denied.txt'))).toBe(false);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it('never infers command consent from migrated local-tool opt-in', async () => {
    updateDesktopSettings(plugin.settings, id, { commandExecution: false });
    expect(getDesktopSettings({}, id).commandExecution).toBe(false);
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    const consent = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(consent);
    jest.mocked(queryDesktopBridge).mockImplementationOnce(async r => proposal(r.prompt, { local_tool: 'run', path: '.', command: 'node', args: ['-e', 'process.exit(0)'] }));
    const chunks = []; for await (const c of runtime.query(runtime.prepareTurn({ text: 'test' }))) chunks.push(c);
    expect(consent).not.toHaveBeenCalled();
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
});
