import { promises as fs } from 'fs';
import type { Plugin } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { SharedStorageService, TAB_STATE_PATH } from '@/app/storage/SharedStorageService';

function createPlugin(vaultPath: string, legacyData: unknown = null) {
  const saveData = jest.fn(async () => undefined);
  const loadData = jest.fn(async () => legacyData);
  const plugin = {
    app: { vault: { adapter: { basePath: vaultPath } } },
    loadData,
    saveData,
  } as unknown as Plugin;
  return { plugin, saveData, loadData };
}

describe('SharedStorageService tab state', () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), 'claudian-vault-'));
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  const state = {
    openTabs: [
      { tabId: 'tab-1', conversationId: 'conv-1', draft: 'halb fertige Frage' },
      { tabId: 'tab-2', conversationId: null, draftModel: 'claude-opus-5-5' },
    ],
    activeTabId: 'tab-1',
  };

  it('writes the tab layout to its own file, never to data.json', async () => {
    const { plugin, saveData } = createPlugin(vault);
    const storage = new SharedStorageService(plugin);

    await storage.setTabManagerState(state);

    const written = JSON.parse(await fs.readFile(path.join(vault, TAB_STATE_PATH), 'utf8'));
    expect(written).toEqual(state);
    expect(saveData).not.toHaveBeenCalled();
  });

  // Regression: validation used to drop `draft`, so a saved draft was thrown
  // away on every load and never survived a restart.
  it('keeps unsent drafts and blank-tab models when reading back', async () => {
    const { plugin } = createPlugin(vault);
    const storage = new SharedStorageService(plugin);
    await storage.setTabManagerState(state);

    await expect(new SharedStorageService(plugin).getTabManagerState()).resolves.toEqual(state);
  });

  it('migrates the layout an older build left in data.json', async () => {
    const { plugin } = createPlugin(vault, { tabManagerState: state });

    await expect(new SharedStorageService(plugin).getTabManagerState()).resolves.toEqual(state);
  });

  it('prefers its own file over a stale data.json layout', async () => {
    const stale = { openTabs: [{ tabId: 'old', conversationId: 'conv-old' }], activeTabId: 'old' };
    const { plugin } = createPlugin(vault, { tabManagerState: stale });
    await new SharedStorageService(plugin).setTabManagerState(state);

    await expect(new SharedStorageService(plugin).getTabManagerState()).resolves.toEqual(state);
  });

  it('falls back to data.json when its own file is unreadable', async () => {
    const { plugin } = createPlugin(vault, { tabManagerState: state });
    await fs.mkdir(path.join(vault, '.claudian'), { recursive: true });
    await fs.writeFile(path.join(vault, TAB_STATE_PATH), '{"openTabs": [');

    await expect(new SharedStorageService(plugin).getTabManagerState()).resolves.toEqual(state);
  });

  it('drops malformed tab entries instead of the whole layout', async () => {
    const { plugin } = createPlugin(vault);
    await fs.mkdir(path.join(vault, '.claudian'), { recursive: true });
    await fs.writeFile(path.join(vault, TAB_STATE_PATH), JSON.stringify({
      openTabs: [{ tabId: 'ok', conversationId: 'conv-ok', draft: 42 }, { conversationId: 'no-id' }, null],
      activeTabId: 'ok',
    }));

    await expect(new SharedStorageService(plugin).getTabManagerState()).resolves.toEqual({
      openTabs: [{ tabId: 'ok', conversationId: 'conv-ok' }],
      activeTabId: 'ok',
    });
  });
});
