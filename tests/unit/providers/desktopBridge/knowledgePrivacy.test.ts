import * as fs from 'fs';
import * as path from 'path';

import { ProviderRegistry } from '../../../../src/core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../../../src/main';
import { queryDesktopBridge } from '../../../../src/providers/desktopBridge/DesktopBridgeTransport';
import { parseKnowledgeProposal } from '../../../../src/providers/desktopBridge/knowledgeProtocol';
import { desktopRegistration } from '../../../../src/providers/desktopBridge/registration';
import { updateDesktopSettings } from '../../../../src/providers/desktopBridge/settings';
jest.mock('../../../../src/providers/desktopBridge/DesktopBridgeTransport', () => ({ ...jest.requireActual('../../../../src/providers/desktopBridge/DesktopBridgeTransport'), queryDesktopBridge: jest.fn() }));
jest.mock('../../../../src/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/fixture/helper', desktopAppPath: () => '/fixture/App.app' }));

describe.each(['grok-bot', 'perplexity-chat'] as const)('knowledge privacy %s', id => {
  it.each(['off', 'memory-off', 'deny', 'yield', 'approval', 'result', 'base', 'scope', 'memory-config', 'pending', 'switch'])('rejects/revokes at %s', async stage => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'knowledge-privacy-')));
    let base = root;
    try {
      fs.mkdirSync(path.join(root, 'Notes')); fs.mkdirSync(path.join(root, '.claudian/memory'), { recursive: true });
      fs.writeFileSync(path.join(root, '.claudian/memory/m.md'), 'banana');
      const plugin = { settings: {}, saveSettings: jest.fn(), app: { vault: { adapter: { getBasePath: () => base, get basePath() { return base; } }, getMarkdownFiles: () => [] }, metadataCache: { resolvedLinks: {} } } } as unknown as ClaudianPlugin;
      updateDesktopSettings(plugin.settings, id, { enabled: true, anchor: 'privacy', knowledgeTools: stage !== 'off', knowledgeScope: 'Notes', knowledgeMemory: stage !== 'memory-off', knowledgeMemoryFolder: '.claudian/memory' });
      ProviderRegistry.register(id, desktopRegistration(id));
      const runtime = ProviderRegistry.createChatRuntime({ plugin, providerId: id });
      const revoke = () => updateDesktopSettings(plugin.settings, id, { knowledgeTools: false });
      let entered!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
      const approve = jest.fn(async () => {
        if (stage === 'approval') revoke();
        if (stage === 'pending' || stage === 'switch') { entered(); return new Promise<'allow'>(() => {}); }
        return stage === 'deny' ? 'deny' as const : 'allow' as const;
      }); runtime.setApprovalCallback(approve);
      jest.mocked(queryDesktopBridge).mockReset().mockImplementation(async request => JSON.stringify({ knowledge_tool: 'recall', nonce: request.prompt.match(/"nonce":"([^"]+)"/)?.[1] ?? 'absent', terms: ['banana'] }));
      const stream = runtime.query(runtime.prepareTurn({ text: 'Recall banana' }));
      const reads = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
      const first = await stream.next();
      if (stage === 'yield') revoke();
      if (stage === 'base') base = path.dirname(root);
      if (stage === 'scope') updateDesktopSettings(plugin.settings, id, { knowledgeScope: 'Other' });
      if (stage === 'memory-config') plugin.settings.memoryFolder = 'Other';
      const pending = stream.next();
      if (stage === 'pending' || stage === 'switch') {
        await waiting;
        if (stage === 'switch') runtime.syncConversationState(null); else revoke();
      }
      const second = await pending;
      if (stage === 'result') revoke();
      const events = [first.value, second.value]; while (true) { const e = await stream.next(); if (e.done) break; events.push(e.value); }
      expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
      expect(reads.mock.calls.length > 0).toBe(stage === 'result');
      reads.mockRestore();
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'text' }));
      expect(fs.readFileSync(path.join(root, '.claudian/memory/m.md'), 'utf8')).toBe('banana');
      runtime.cleanup();
    } finally { jest.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
it.each([
  { knowledge_tool: 'recall', nonce: 'old', terms: ['banana'] },
  { knowledge_tool: 'recall', nonce: 'n', terms: ['banana'], path: 'elsewhere' },
  { knowledge_tool: 'recall', nonce: 'n', terms: ['whole prompt with spaces'] },
  { knowledge_tool: 'graph', nonce: 'n', seed: 'Notes/a.md', depth: 99, direction: 'both' },
  { knowledge_tool: 'read', nonce: 'n', ids: ['path.md'] },
])('rejects strict invalid proposal %j', proposal => {
  expect(() => parseKnowledgeProposal(JSON.stringify(proposal), 'n')).toThrow();
});
