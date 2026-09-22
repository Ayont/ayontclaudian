import '@/providers';

import { CLAUDIAN_SETTINGS_PATH, ClaudianSettingsStorage } from '@/app/settings/ClaudianSettingsStorage';
import { SESSIONS_INDEX_PATH, SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import { CLI_INSTALL_CATALOG } from '@/core/install/cliInstallCatalog';
import { getCliUpdateSpec } from '@/core/install/cliUpdateCatalog';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

function memoryAdapter(files: Map<string, string>): VaultFileAdapter {
  return {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`ENOENT ${path}`);
      }
      return content;
    },
    write: async (path: string, content: string) => {
      files.set(path, content);
    },
    delete: async (path: string) => {
      files.delete(path);
    },
    listFiles: async (folder: string) => (
      [...files.keys()].filter((path) => path.startsWith(`${folder}/`))
    ),
    stat: async (path: string) => (
      files.has(path) ? { mtime: 1, size: files.get(path)!.length } : null
    ),
  } as unknown as VaultFileAdapter;
}

describe('Freebuff removal', () => {
  it('does not register Freebuff or offer it in catalogs', () => {
    const ids = ProviderRegistry.getRegisteredProviderIds();
    expect(ids).toEqual(expect.arrayContaining([
      'claude',
      'codex',
      'cline',
      'opencode',
      'grok',
      'hermes',
      'kimi',
      'vibe',
      'antigravity',
      'omp',
      'pi',
      'dsh',
      'zcode',
    ]));
    expect(ids).not.toContain('freebuff');
    expect(ProviderRegistry.getProviderRegistrationSafe('freebuff')).toBeNull();
    expect(CLI_INSTALL_CATALOG.freebuff).toBeUndefined();
    expect(getCliUpdateSpec('freebuff')).toBeNull();
    expect(Object.keys(getBuiltInProviderDefaultConfigs())).not.toContain('freebuff');
  });

  it('loads a leftover freebuff settings file and session without starting Freebuff', async () => {
    const files = new Map<string, string>();
    const adapter = memoryAdapter(files);
    files.set(CLAUDIAN_SETTINGS_PATH, JSON.stringify({
      settingsProvider: 'freebuff',
      providerConfigs: {
        freebuff: { enabled: true, model: 'deepseek/deepseek-v4-flash' },
      },
    }));

    const loaded = await new ClaudianSettingsStorage(adapter).load();
    expect(ProviderSettingsCoordinator.normalizeProviderSelection(
      loaded as unknown as Record<string, unknown>,
    )).toBe(true);
    expect(loaded.settingsProvider).toBe('claude');
    expect(ProviderRegistry.resolveProviderForModel(
      'deepseek/deepseek-v4-flash',
      loaded as unknown as Record<string, unknown>,
    )).not.toBe('freebuff');
    expect(() => ProviderRegistry.createChatRuntime({
      plugin: { settings: loaded } as never,
      providerId: 'freebuff',
    })).toThrow(/not registered/);

    const id = 'conv-old-freebuff';
    const storedSession = {
      id,
      providerId: 'freebuff',
      title: 'Old Freebuff chat',
      createdAt: 1,
      updatedAt: 2,
      sessionId: 'freebuff-thread',
      providerState: { threadId: 'freebuff-thread' },
      messages: [{ id: 'u1', role: 'user', content: 'still here', timestamp: 1 }],
    };
    files.set(`${SESSIONS_PATH}/${id}.meta.json`, JSON.stringify(storedSession));
    files.set(SESSIONS_INDEX_PATH, JSON.stringify({
      [id]: { ...storedSession, messages: [] },
    }));

    const sessions = new SessionStorage(adapter);
    try {
      const listed = await sessions.listMetadata();
      const fromIndex = listed.find((item) => item.id === id);
      const fromFile = await sessions.loadMetadata(id);

      expect(fromIndex?.providerId).toBe('claude');
      expect(fromIndex?.sessionId).toBeNull();
      expect(fromIndex?.providerState).toBeUndefined();
      expect(fromFile?.providerId).toBe('claude');
      expect(fromFile?.sessionId).toBeNull();
      expect(fromFile?.providerState).toBeUndefined();
      expect(fromFile?.messages?.[0]?.content).toBe('still here');
    } finally {
      sessions.resetIndexCache();
    }
  });
});
