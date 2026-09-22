import * as fs from 'fs';
import { TFile } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type ClaudianPlugin from '../../../../src/main';
import { DesktopBridgeRuntime } from '../../../../src/providers/desktopBridge/DesktopBridgeRuntime';
import { queryDesktopBridge } from '../../../../src/providers/desktopBridge/DesktopBridgeTransport';
import { updateDesktopSettings } from '../../../../src/providers/desktopBridge/settings';
jest.mock('../../../../src/utils/path', () => ({ getVaultPath: (app: any) => app.vault.adapter.getBasePath() }));
jest.mock('../../../../src/providers/desktopBridge/DesktopBridgeTransport', () => ({ queryDesktopBridge: jest.fn() }));
jest.mock('../../../../src/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/fixture', desktopAppPath: () => '/Applications/Fixture.app' }));
it.each(['grok-bot', 'perplexity-chat'] as const)('rejects selected symlinks without adapter read or egress %s', async id => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selected-context-')));
  try {
    fs.writeFileSync(path.join(root, 'actual.md'), 'private fixture');
    fs.symlinkSync(path.join(root, 'actual.md'), path.join(root, 'note.md'));
    const file = Object.assign(new TFile(), { path: 'note.md', extension: 'md', stat: { size: 15 } });
    const read = jest.fn().mockResolvedValue('private fixture');
    const plugin = { settings: {}, saveSettings: jest.fn(), app: { vault: { adapter: { read, getBasePath: () => root }, getAbstractFileByPath: () => file } } } as unknown as ClaudianPlugin;
    updateDesktopSettings(plugin.settings, id, { enabled: true, anchor: 'fixture', contextTools: true });
    const runtime = new DesktopBridgeRuntime(plugin, id);
    runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow'));
    jest.mocked(queryDesktopBridge).mockReset().mockResolvedValue('answer');
    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Read', desktopContext: () => [{ kind: 'note-file', file }] }))) chunks.push(chunk);
    expect(chunks.some(c => c.type === 'error')).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(queryDesktopBridge).not.toHaveBeenCalled();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it.each(['allow', 'deny', 'rename', 'cancel', 'revoke'] as const)('reads only the real selected note after source decision %s', async decision => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'selected-note-')));
  try {
    fs.writeFileSync(path.join(root, 'note.md'), 'synthetic selected note');
    const file = Object.assign(new TFile(), { path: 'note.md', extension: 'md', stat: { size: 23 } });
    const adapterRead = jest.fn();
    const plugin = { settings: {}, saveSettings: jest.fn(), app: { vault: { adapter: { read: adapterRead, getBasePath: () => root }, getAbstractFileByPath: () => file } } } as unknown as ClaudianPlugin;
    updateDesktopSettings(plugin.settings, 'grok-bot', { enabled: true, anchor: 'fixture', contextTools: true });
    const runtime = new DesktopBridgeRuntime(plugin, 'grok-bot');
    const read = jest.spyOn(jest.requireActual<typeof fs>('fs'), 'readSync');
    runtime.setApprovalCallback(jest.fn(async name => {
      expect(name !== 'Context sources' || read.mock.calls.length === 0).toBe(true);
      if (name === 'Context sources') {
        if (decision === 'rename') file.path = 'other.md';
        if (decision === 'cancel') runtime.cancel();
        if (decision === 'revoke') updateDesktopSettings(plugin.settings, 'grok-bot', { contextTools: false });
      }
      return decision === 'deny' ? 'deny' : 'allow';
    }));
    jest.mocked(queryDesktopBridge).mockReset().mockResolvedValue('received');
    try {
      const chunks = [];
      for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Read', desktopContext: () => [{ kind: 'note-file', file }] }))) chunks.push(chunk);
      expect(adapterRead).not.toHaveBeenCalled();
      expect(read.mock.calls.length > 0).toBe(decision === 'allow');
      expect(chunks.some(c => c.type === 'text' && c.content === 'received')).toBe(decision === 'allow');
      expect(queryDesktopBridge).toHaveBeenCalledTimes(decision === 'allow' ? 1 : 0);
    } finally { read.mockRestore(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it.each([false, true])('fits actual context continuation with combined tools commands=%s', async commands => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'context-wire-')));
  try {
    const plugin = { settings: {}, saveSettings: jest.fn(), app: { vault: { adapter: { getBasePath: () => root } } } } as unknown as ClaudianPlugin;
    updateDesktopSettings(plugin.settings, 'grok-bot', { enabled: true, anchor: 'fixture', contextTools: true, vaultTools: true, vaultRoot: root, localTools: true, toolRoot: root, commandExecution: commands });
    const runtime = new DesktopBridgeRuntime(plugin, 'grok-bot');
    runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow'));
    jest.mocked(queryDesktopBridge).mockReset().mockImplementationOnce(async request => {
      expect(request.prompt.length).toBeLessThanOrEqual(2000);
      return JSON.stringify({ context_tool: 'read', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], pageId: request.prompt.match(/"firstPageId":"([^"]+)"/)![1] });
    }).mockImplementationOnce(async request => { expect(request.prompt.length).toBeLessThanOrEqual(2000); return 'received'; });
    const chunks = [];
    for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Summarize', desktopContext: () => [{ kind: 'selection', label: 'fixture', text: '\u0001'.repeat(600) }] }))) chunks.push(chunk);
    expect(chunks).toContainEqual({ type: 'text', content: 'received' });
    expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it.each(['grok-bot', 'perplexity-chat'] as const)('consents metadata and exact selected page before sending %s', async id => {
  const plugin = { settings: {}, saveSettings: jest.fn() } as unknown as ClaudianPlugin;
  updateDesktopSettings(plugin.settings, id, { enabled: true, anchor: 'fixture', contextTools: true });
  const runtime = new DesktopBridgeRuntime(plugin, id);
  const approve = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(approve);
  jest.mocked(queryDesktopBridge).mockReset().mockImplementationOnce(async request => {
    expect(approve).toHaveBeenCalledTimes(2);
    expect(request.prompt).not.toContain('selected secret');
    return JSON.stringify({ context_tool: 'read', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], pageId: request.prompt.match(/"firstPageId":"([^"]+)"/)![1] });
  }).mockImplementationOnce(async request => { expect(request.prompt).toContain('selected secret'); expect(request.prompt.length).toBeLessThanOrEqual(2000); return 'received'; });
  const chunks = [];
  for await (const chunk of runtime.query(runtime.prepareTurn({ text: 'Summarize', desktopContext: () => [{ kind: 'selection', label: 'explicit selection', text: 'selected secret' }] }))) chunks.push(chunk);
  expect(chunks).toContainEqual({ type: 'text', content: 'received' });
  expect(approve).toHaveBeenCalledTimes(3);
});
