import * as fs from 'fs';
import * as path from 'path';

import { McpServerManager } from '../../../../src/core/mcp/McpServerManager';
import { ProviderRegistry } from '../../../../src/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '../../../../src/core/providers/ProviderWorkspaceRegistry';
import type ClaudianPlugin from '../../../../src/main';
import { queryDesktopBridge } from '../../../../src/providers/desktopBridge/DesktopBridgeTransport';
import { desktopRegistration } from '../../../../src/providers/desktopBridge/registration';
import { updateDesktopSettings } from '../../../../src/providers/desktopBridge/settings';
jest.mock('../../../../src/providers/desktopBridge/DesktopBridgeTransport', () => ({ ...jest.requireActual('../../../../src/providers/desktopBridge/DesktopBridgeTransport'), queryDesktopBridge: jest.fn() }));
jest.mock('../../../../src/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/fixture/helper', desktopAppPath: () => '/fixture/App.app' }));

describe.each(['grok-bot', 'perplexity-chat'] as const)('registered knowledge %s', id => {
  let root: string;
  beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'knowledge-runtime-'))); jest.mocked(queryDesktopBridge).mockReset(); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
  it.each(['graph', 'recall'].flatMap(operation => Array.from({ length: 16 }, (_, mask) => ({ operation, mask }))))('reads approved raw $operation with family mask $mask', async ({ operation, mask }) => {
    fs.mkdirSync(path.join(root, 'Notes')); fs.mkdirSync(path.join(root, '.claudian/memory'), { recursive: true });
    const raw = '---\ntitle: banana\n---\n\nbanana exact raw text\n' + '"\\😀'.repeat(200);
    fs.writeFileSync(path.join(root, 'Notes/a.md'), 'seed'); fs.writeFileSync(path.join(root, 'Notes/b.md'), raw);
    fs.writeFileSync(path.join(root, '.claudian/memory/m.md'), raw);
    const plugin = { settings: {}, saveSettings: jest.fn(), app: { vault: { adapter: { getBasePath: () => root, basePath: root }, getMarkdownFiles: () => [{ path: 'Notes/a.md' }, { path: 'Notes/b.md' }] }, metadataCache: { resolvedLinks: { 'Notes/b.md': { 'Notes/a.md': 1 } } } } } as unknown as ClaudianPlugin;
    updateDesktopSettings(plugin.settings, id, { enabled: true, anchor: 'synthetic', localTools: !!(mask & 1), commandExecution: !!(mask & 2), vaultTools: !!(mask & 4), desktopMcp: !!(mask & 8), toolRoot: root, vaultRoot: root, knowledgeTools: true, knowledgeScope: 'Notes', knowledgeMemory: true, knowledgeMemoryFolder: '.claudian/memory' });
    const manager = new McpServerManager({ load: async () => [] }); await manager.loadServers();
    ProviderWorkspaceRegistry.setServices(id, { mcpServerManager: manager });
    ProviderRegistry.register(id, desktopRegistration(id));
    const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
    const approval = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(approval);
    const selection = [...(mask & 8 ? ['mcp'] : []), ...(mask & 4 ? ['vault'] : []), ...(mask & 1 ? ['local'] : []), 'knowledge'];
    let switches = 0;
    let step = 0; let reconstructed = ''; let pages = 0;
    jest.mocked(queryDesktopBridge).mockImplementation(async request => {
      expect(request.prompt.length).toBeLessThanOrEqual(2000);
      const nonce = request.prompt.match(/"nonce":"([^"]+)"/)![1];
      if (switches < selection.length) return JSON.stringify({ protocol_tool: 'select', nonce, family: selection[switches++] });
      const payload = () => JSON.parse(request.prompt.split('(untrusted data): ')[1].split('\nContinue')[0]);
      if (step++ === 0) return JSON.stringify(operation === 'graph' ? { knowledge_tool: 'graph', nonce, seed: 'Notes/a.md', direction: 'backlinks', depth: 1 } : { knowledge_tool: 'recall', nonce, terms: ['banana'] });
      if (step === 2) { const result = payload(); return JSON.stringify({ knowledge_tool: 'read', nonce, ids: [result.items[0].id] }); }
      if (step === 3) { const result = payload(); return JSON.stringify({ context_tool: 'read', nonce, pageId: result.items[0].firstPageId }); }
      const page = payload(); reconstructed += page.data; pages++;
      if (page.nextPageId) return JSON.stringify({ context_tool: 'read', nonce, pageId: page.nextPageId });
      return 'verified raw fixture';
    });
    const events = []; for await (const e of runtime.query(runtime.prepareTurn({ text: 'Use selected knowledge' }))) events.push(e);
    expect(events).toContainEqual({ type: 'text', content: 'verified raw fixture' });
    expect(reconstructed).toBe(raw); expect(pages).toBeGreaterThan(1);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(3 + pages + switches);
    expect(approval.mock.calls.map(c => c[0]).filter(name => !name.startsWith('MCP '))).toEqual([`Knowledge ${operation === 'graph' ? 'graph-metadata-local' : 'memory-read-local'}`, 'Knowledge metadata-egress', 'Knowledge note-read-local', 'Context metadata', ...Array(pages).fill('Context page')]);
  });
});
