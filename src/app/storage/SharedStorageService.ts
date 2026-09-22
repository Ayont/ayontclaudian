import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import * as path from 'path';

import { SESSIONS_PATH, SessionStorage } from '../../core/bootstrap/SessionStorage';
import type { SharedAppStorage } from '../../core/bootstrap/storage';
import { CLAUDIAN_STORAGE_PATH } from '../../core/bootstrap/StoragePaths';
import type { AppTabManagerState } from '../../core/providers/types';
import { readJsonFile, SerialJsonFileWriter } from '../../core/storage/atomicJsonFile';
import { VaultFileAdapter } from '../../core/storage/VaultFileAdapter';
import { getVaultPath } from '../../utils/path';
import { ClaudianSettingsStorage, type StoredClaudianSettings } from '../settings/ClaudianSettingsStorage';

/**
 * The open-tab layout lives in its own file, written by rename. It used to share
 * data.json with Obsidian's in-place writer: two shutdown paths rewrote that file
 * concurrently while Obsidian quit, a cut-off write left it empty, and the next
 * start came up with one blank tab.
 */
export const TAB_STATE_PATH = `${CLAUDIAN_STORAGE_PATH}/tab-state.json`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class SharedStorageService implements SharedAppStorage {
  readonly claudianSettings: ClaudianSettingsStorage;
  readonly sessions: SessionStorage;

  private adapter: VaultFileAdapter;
  private plugin: Plugin;
  private readonly tabStateFile: string | null;
  private readonly tabStateWriter: SerialJsonFileWriter | null;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.adapter = new VaultFileAdapter(plugin.app);
    this.claudianSettings = new ClaudianSettingsStorage(this.adapter);
    this.sessions = new SessionStorage(this.adapter);
    const vaultPath = getVaultPath(plugin.app);
    this.tabStateFile = vaultPath ? path.join(vaultPath, TAB_STATE_PATH) : null;
    this.tabStateWriter = this.tabStateFile ? new SerialJsonFileWriter(this.tabStateFile) : null;
  }

  async initialize(): Promise<{ claudian: Record<string, unknown> }> {
    await this.ensureDirectories();
    const claudian = await this.claudianSettings.load();
    return { claudian };
  }

  async saveClaudianSettings(settings: Record<string, unknown>): Promise<void> {
    await this.claudianSettings.save(settings as StoredClaudianSettings);
  }

  async setTabManagerState(state: AppTabManagerState): Promise<void> {
    const validated = this.validateTabManagerState(state) ?? { openTabs: [], activeTabId: null };
    try {
      if (this.tabStateWriter) {
        await this.tabStateWriter.write(validated);
        return;
      }
      // No filesystem path (not a desktop vault): keep the previous data.json home.
      const loaded: unknown = await this.plugin.loadData();
      const data = isRecord(loaded) ? loaded : {};
      data.tabManagerState = validated;
      await this.plugin.saveData(data);
    } catch {
      new Notice('Tab-Layout konnte nicht gespeichert werden.');
    }
  }

  async getTabManagerState(): Promise<AppTabManagerState | null> {
    if (this.tabStateFile) {
      const stored = this.validateTabManagerState(await readJsonFile(this.tabStateFile));
      if (stored) {
        this.tabStateWriter?.markWritten(stored);
        return stored;
      }
    }
    // Older builds kept the layout in data.json; read it once so an update does
    // not reset the open tabs. The next save moves it to the new file.
    try {
      const data: unknown = await this.plugin.loadData();
      if (!isRecord(data) || !data.tabManagerState) {
        return null;
      }
      return this.validateTabManagerState(data.tabManagerState);
    } catch {
      return null;
    }
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }

  private async ensureDirectories(): Promise<void> {
    await this.adapter.ensureFolder(CLAUDIAN_STORAGE_PATH);
    await this.adapter.ensureFolder(SESSIONS_PATH);
  }

  private validateTabManagerState(data: unknown): AppTabManagerState | null {
    if (!isRecord(data) || !Array.isArray(data.openTabs)) {
      return null;
    }

    const openTabs: AppTabManagerState['openTabs'] = [];
    for (const tab of data.openTabs) {
      if (!isRecord(tab) || typeof tab.tabId !== 'string') {
        continue;
      }
      openTabs.push({
        tabId: tab.tabId,
        conversationId: typeof tab.conversationId === 'string' ? tab.conversationId : null,
        ...(typeof tab.draftModel === 'string' ? { draftModel: tab.draftModel } : {}),
        ...(typeof tab.draft === 'string' && tab.draft ? { draft: tab.draft } : {}),
      });
    }

    return {
      openTabs,
      activeTabId: typeof data.activeTabId === 'string' ? data.activeTabId : null,
    };
  }
}
