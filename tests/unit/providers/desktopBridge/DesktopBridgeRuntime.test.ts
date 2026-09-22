import * as fs from 'fs';
import * as path from 'path';

import { buildProviderSwitchCarry } from '@/core/conversation/ConversationContextBootstrap';

import type ClaudianPlugin from '../../../../src/main';
import { DesktopBridgeRuntime } from '../../../../src/providers/desktopBridge/DesktopBridgeRuntime';
import { queryDesktopBridge } from '../../../../src/providers/desktopBridge/DesktopBridgeTransport';
import { getDesktopSettings, updateDesktopSettings } from '../../../../src/providers/desktopBridge/settings';
jest.mock('../../../../src/providers/desktopBridge/DesktopBridgeTransport', () => ({ queryDesktopBridge: jest.fn() }));
jest.mock('../../../../src/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/plugin/bridge.swift', desktopAppPath: () => '/Applications/App.app' }));
const collect = async (runtime: DesktopBridgeRuntime, text = 'prepared context') => { const chunks = []; for await (const chunk of runtime.query(runtime.prepareTurn({ text }))) chunks.push(chunk); return chunks; };
describe('desktop relay runtime', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(queryDesktopBridge).mockReset(); });
  it.each(['grok-bot', 'perplexity-chat'] as const)('routes local proposals through approval for %s', async id => {
    const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'local', localTools: true, toolRoot: '/not-used' });
    const runtime = new DesktopBridgeRuntime(p, id);
    const approval = jest.fn().mockResolvedValue('deny'); runtime.setApprovalCallback(approval);
    jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => {
      const nonce = request.prompt.match(/"nonce":"([^"]+)"/)![1];
      return JSON.stringify({ local_tool: 'read', nonce, path: '../blocked' });
    });
    const chunks = await collect(runtime, 'Read a fixture');
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
    expect(approval).not.toHaveBeenCalled();
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool_use' }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'error' }));
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('continues a real approved fixture read for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'relay-loop-')));
    try {
      fs.writeFileSync(path.join(root, 'note.txt'), 'harmless-fixture');
      const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'loop', localTools: true, toolRoot: root });
      const runtime = new DesktopBridgeRuntime(p, id);
      const approve = jest.fn().mockResolvedValue('allow'); runtime.setApprovalCallback(approve);
      jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => JSON.stringify({ local_tool: 'read', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: 'note.txt' })).mockImplementationOnce(async request => {
        expect(request.prompt).toContain('harmless-fixture'); expect(request.prompt.length).toBeLessThanOrEqual(2000); return 'fixture read confirmed';
      });
      const chunks = await collect(runtime, 'Read note.txt');
      expect(approve).toHaveBeenCalledTimes(1);
      expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
      expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool_result', content: expect.stringContaining('harmless-fixture') }));
      expect(chunks).toContainEqual({ type: 'text', content: 'fixture read confirmed' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('invalidates a pending approval on cancellation for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'relay-cancel-')));
    try {
      fs.writeFileSync(path.join(root, 'note.txt'), 'unchanged');
      const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'cancel-tool', localTools: true, toolRoot: root });
      const runtime = new DesktopBridgeRuntime(p, id);
      let release!: (value: 'allow') => void;
      runtime.setApprovalCallback(() => new Promise(resolve => { release = resolve; }));
      const dismiss = jest.fn(() => release('allow'));
      runtime.setApprovalDismisser(dismiss);
      jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => JSON.stringify({ local_tool: 'write', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: 'note.txt', content: 'changed' }));
      const turn = runtime.query(runtime.prepareTurn({ text: 'Write note.txt' }));
      expect((await turn.next()).value).toMatchObject({ type: 'tool_use' });
      const pending = turn.next();
      runtime.cancel();
      await pending;
      while (!(await turn.next()).done) { /* Drain terminal events. */ }
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('unchanged');
      expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('rejects an old nonce without approval or continuation for %s', async id => {
    const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'nonce', localTools: true, toolRoot: '/unused' });
    const runtime = new DesktopBridgeRuntime(p, id);
    const approve = jest.fn(); runtime.setApprovalCallback(approve);
    jest.mocked(queryDesktopBridge).mockResolvedValueOnce(JSON.stringify({ local_tool: 'read', nonce: 'stale', path: 'note.txt' }));
    expect(await collect(runtime)).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(approve).not.toHaveBeenCalled();
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('revalidates tool settings after approval for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'relay-settings-')));
    try {
      fs.writeFileSync(path.join(root, 'note.txt'), 'unchanged');
      const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'settings', localTools: true, toolRoot: root });
      const runtime = new DesktopBridgeRuntime(p, id);
      runtime.setApprovalCallback(async () => { updateDesktopSettings(p.settings, id, { localTools: false }); return 'allow'; });
      jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => JSON.stringify({ local_tool: 'write', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: 'note.txt', content: 'changed' }));
      expect(await collect(runtime)).toContainEqual(expect.objectContaining({ type: 'error' }));
      expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('unchanged');
      expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('continues nonzero host results for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'coding-loop-')));
    try {
      fs.writeFileSync(path.join(root, 'fail.js'), 'process.stdout.write("correct-me");process.exitCode=3;');
      const p = plugin(); updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'coding', localTools: true, commandExecution: true, toolRoot: root });
      const runtime = new DesktopBridgeRuntime(p, id); runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow'));
      jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => {
        expect(request.prompt).toContain('run');
        return JSON.stringify({ local_tool: 'run', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: '.', command: 'node', args: ['fail.js'] });
      }).mockImplementationOnce(async request => { expect(request.prompt).toContain('"exitCode":3'); expect(request.prompt.length).toBeLessThanOrEqual(2000); return 'will correct'; });
      expect(await collect(runtime, 'Test fixture')).toContainEqual({ type: 'text', content: 'will correct' });
      expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('budgets actual vault/local continuations for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'vault-wire-')));
    try {
      fs.writeFileSync(path.join(root, 'note.md'), '\u0001"\\'.repeat(1000));
      for (const localTools of [false, true]) for (const commandExecution of [false, true]) {
        jest.mocked(queryDesktopBridge).mockReset();
        const p = plugin();
        p.app = { vault: { adapter: { basePath: root }, getMarkdownFiles: () => [{ path: 'note.md' }] } } as unknown as ClaudianPlugin['app'];
        updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'vault-wire', vaultTools: true, vaultRoot: root, localTools, commandExecution, toolRoot: root });
        const runtime = new DesktopBridgeRuntime(p, id); runtime.setApprovalCallback(jest.fn().mockResolvedValue('allow'));
        jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => JSON.stringify({ vault_tool: 'read', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: 'note.md' })).mockImplementationOnce(async request => {
          expect(request.prompt.length).toBeLessThanOrEqual(2000);
          expect(request.prompt).toContain('nextOffset'); return 'page received';
        });
        expect(await collect(runtime, 'Read note.md')).toContainEqual({ type: 'text', content: 'page received' });
        expect(queryDesktopBridge).toHaveBeenCalledTimes(2);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects a symlink vault scope before the first model send', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'vault-scope-')));
    try {
      fs.mkdirSync(path.join(root, 'actual')); fs.symlinkSync(path.join(root, 'actual'), path.join(root, 'link'));
      const p = plugin(); p.app = { vault: { adapter: { basePath: root } } } as unknown as ClaudianPlugin['app'];
      updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'scope', vaultTools: true, vaultRoot: path.join(root, 'link') });
      jest.mocked(queryDesktopBridge).mockResolvedValueOnce('answer');
      expect(await collect(new DesktopBridgeRuntime(p, 'grok-bot'))).toContainEqual(expect.objectContaining({ type: 'error' }));
      expect(queryDesktopBridge).not.toHaveBeenCalled();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('stops vault execution and continuation after revocation for %s', async id => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), 'tests', 'vault-revoke-')));
    try {
      fs.writeFileSync(path.join(root, 'note.md'), 'fixture');
      for (const stage of ['proposal', 'approval', 'result', 'vault-change']) {
        jest.mocked(queryDesktopBridge).mockReset();
        const p = plugin(); p.app = { vault: { adapter: { basePath: root }, getMarkdownFiles: () => [{ path: 'note.md' }] } } as unknown as ClaudianPlugin['app'];
        updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'revoke', vaultTools: true, vaultRoot: root });
        const runtime = new DesktopBridgeRuntime(p, id);
        const revoke = () => updateDesktopSettings(p.settings, id, { vaultTools: false });
        const approve = jest.fn(async () => { if (stage === 'approval') revoke(); return 'allow' as const; }); runtime.setApprovalCallback(approve);
        jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => JSON.stringify({ vault_tool: 'read', nonce: request.prompt.match(/"nonce":"([^"]+)"/)![1], path: 'note.md' }));
        const stream = runtime.query(runtime.prepareTurn({ text: 'Read note.md' }));
        expect((await stream.next()).value).toMatchObject({ type: 'tool_use' });
        if (stage === 'proposal') revoke();
        if (stage === 'vault-change') (p.app.vault.adapter as unknown as { basePath: string }).basePath = path.dirname(root);
        const event = (await stream.next()).value;
        const successfulResult = { type: 'tool_result', content: expect.stringContaining('fixture') };
        expect(event).toMatchObject(stage === 'result' ? successfulResult : { type: 'tool_result', isError: true });
        if (stage === 'result') revoke();
        while (!(await stream.next()).done) { /* Drain without another send. */ }
        expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
        expect(approve).toHaveBeenCalledTimes(stage === 'proposal' || stage === 'vault-change' ? 0 : 1);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects unsupported context instead of silently discarding it', () => {
    const runtime = new DesktopBridgeRuntime(plugin(), 'grok-bot');
    for (const field of ['editorSelection', 'browserSelection', 'canvasSelection', 'currentNotePath']) {
      expect(() => runtime.prepareTurn({ text: 'hello', [field]: 'context' })).toThrow(/Kontext/);
    }
  });
  it('does not send or retain a claim after settings save failure', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'save' });
    jest.mocked(p.saveSettings).mockRejectedValueOnce(new Error('disk full'));
    expect(await collect(new DesktopBridgeRuntime(p, 'grok-bot'))).toContainEqual({ type: 'error', content: 'disk full' });
    expect(queryDesktopBridge).not.toHaveBeenCalled();
    expect(getDesktopSettings(p.settings, 'grok-bot').bindings.save).toBeUndefined();
  });
  it.each([{ enabled: false }, { anchor: 'changed' }])('does not send after settings change while saving: %j', async update => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'original' });
    jest.mocked(p.saveSettings).mockImplementationOnce(async () => { updateDesktopSettings(p.settings, 'grok-bot', update); });
    expect(await collect(new DesktopBridgeRuntime(p, 'grok-bot'))).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(queryDesktopBridge).not.toHaveBeenCalled();
  });
  it('does not claim an anchor after sync cancels a pending readiness check', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'race' });
    const runtime = new DesktopBridgeRuntime(p, 'grok-bot');
    jest.spyOn(runtime, 'ensureReady').mockImplementationOnce(async () => { runtime.syncConversationState(null); return true; });
    await collect(runtime);
    expect(queryDesktopBridge).not.toHaveBeenCalled();
    expect(p.saveSettings).not.toHaveBeenCalled();
  });
  it('rejects a prompt past the context window before claiming or sending', async () => {
    const p = plugin();
    p.settings.customContextLimits = { 'desktop:grok-bot': 1 };
    updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'size' });
    expect(await collect(new DesktopBridgeRuntime(p, 'grok-bot'), 'x'.repeat(20))).toContainEqual(expect.objectContaining({ type: 'error', content: expect.stringContaining('Kontextfenster') }));
    expect(p.saveSettings).not.toHaveBeenCalled();
    expect(queryDesktopBridge).not.toHaveBeenCalled();
  });
  it.each(['grok-bot', 'perplexity-chat'] as const)('submits a fitting watermarked carry on the relay payload for %s', async id => {
    const covered = 'DESKTOP-ALREADY-HAS-THIS';
    const uncovered = 'TURN-AFTER-LEAVING-DESKTOP';
    const filePath = `vault/${'p'.repeat(144)}`;
    const outcome = 'R'.repeat(2000);
    const goal = 'Portal migration stays reversible';
    const windowTokens = id === 'grok-bot' ? 500_000 : 200_000;
    const carry = buildProviderSwitchCarry({
      messages: [
        { id: 'covered', role: 'user', content: covered, timestamp: 1 },
        { id: 'later', role: 'user', content: uncovered, timestamp: 2 },
        {
          id: 'tool',
          role: 'assistant',
          content: 'wrote the plan',
          timestamp: 3,
          toolCalls: [{
            id: 't',
            name: 'Write',
            input: { file_path: filePath },
            status: 'completed',
            result: outcome,
          }],
        },
      ],
      coveredThroughMessageId: 'covered',
      contextWindowTokens: windowTokens,
      goal,
    });
    const userLine = 'Continue from the other provider.';
    const text = `${carry}\n\n${userLine}`;
    const p = plugin();
    updateDesktopSettings(p.settings, id, { enabled: true, anchor: 'carry' });
    jest.mocked(queryDesktopBridge).mockResolvedValue('continued');

    const chunks = await collect(new DesktopBridgeRuntime(p, id), text);

    expect(text.length).toBeGreaterThan(2000);
    expect(text.length).toBeLessThanOrEqual(windowTokens * 4);
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
    const payload = jest.mocked(queryDesktopBridge).mock.calls[0][0];
    expect(payload.provider).toBe(id);
    expect(payload.anchor).toBe('carry');
    expect(payload.prompt).toContain(uncovered);
    expect(payload.prompt).toContain(filePath);
    expect(payload.prompt).toContain(outcome);
    expect(payload.prompt).toContain(goal);
    expect(payload.prompt).toContain(userLine);
    expect(payload.prompt).not.toContain(covered);
    expect(payload.prompt.length).toBeGreaterThan(2000);
    expect(chunks).toContainEqual({ type: 'text', content: 'continued' });
  });
  const plugin = () => ({ settings: {}, saveSettings: jest.fn().mockResolvedValue(undefined) }) as unknown as ClaudianPlugin;
  it('surfaces transport errors without retries', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'perplexity-chat', { enabled: true, anchor: 'errors' });
    jest.mocked(queryDesktopBridge).mockRejectedValueOnce(new Error('anchor mismatch'));
    expect(await collect(new DesktopBridgeRuntime(p, 'perplexity-chat'))).toEqual([{ type: 'error', content: 'anchor mismatch' }]);
  });
  it('cancels an active wait and suppresses late output', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'cancel' });
    const runtime = new DesktopBridgeRuntime(p, 'grok-bot');
    jest.mocked(queryDesktopBridge).mockImplementationOnce(async request => { runtime.cancel(); expect(request.signal?.aborted).toBe(true); return 'late'; });
    expect(await collect(runtime)).toEqual([]);
  });
  it('resumes only its own persisted binding', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'resume' });
    jest.mocked(queryDesktopBridge).mockResolvedValue('answer');
    const first = new DesktopBridgeRuntime(p, 'grok-bot'); await collect(first);
    const resumed = new DesktopBridgeRuntime(p, 'grok-bot');
    resumed.syncConversationState({ sessionId: null, providerState: first.buildSessionUpdates().updates.providerState });
    expect(await collect(resumed)).toContainEqual({ type: 'text', content: 'answer' });
  });
  it('refuses moving an existing conversation to another app anchor', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'one' });
    jest.mocked(queryDesktopBridge).mockResolvedValue('answer');
    const runtime = new DesktopBridgeRuntime(p, 'grok-bot'); await collect(runtime);
    updateDesktopSettings(p.settings, 'grok-bot', { anchor: 'two' });
    expect(await collect(runtime)).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(queryDesktopBridge).toHaveBeenCalledTimes(1);
  });
  it('defaults disabled and keeps provider settings separate', () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'unique' });
    expect(getDesktopSettings(p.settings, 'perplexity-chat').enabled).toBe(false);
  });
  it('preserves the full prepared prompt and refuses another chat on the same anchor', async () => {
    const p = plugin(); updateDesktopSettings(p.settings, 'grok-bot', { enabled: true, anchor: 'unique' });
    jest.mocked(queryDesktopBridge).mockResolvedValue('answer');
    const a = new DesktopBridgeRuntime(p, 'grok-bot');
    expect(await collect(a)).toContainEqual({ type: 'text', content: 'answer' });
    expect(queryDesktopBridge).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'prepared context', anchor: 'unique' }));
    const b = new DesktopBridgeRuntime(p, 'grok-bot');
    expect(await collect(b)).toContainEqual(expect.objectContaining({ type: 'error' }));
  });
});
