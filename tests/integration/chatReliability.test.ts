import { Notice } from 'obsidian';

jest.mock('fs');

import ClaudianPlugin from '@/main';

const MockNotice = Notice as unknown as jest.Mock;

/** A vault adapter backed by a Map, so saves can be read back. */
function memoryVault(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
  const adapter = {
    basePath: '/test/vault',
    exists: jest.fn(async (path: string) => files.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`))),
    read: jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    }),
    write: jest.fn(async (path: string, content: string) => { files.set(path, content); }),
    remove: jest.fn(async (path: string) => { files.delete(path); }),
    mkdir: jest.fn(async () => undefined),
    list: jest.fn(async (folder: string) => ({
      files: [...files.keys()].filter((path) => folderOf(path) === folder),
      folders: [],
    })),
    stat: jest.fn(async (path: string) => (files.has(path) ? { mtime: 1, size: files.get(path)!.length } : null)),
    rename: jest.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, content);
    }),
  };
  return { adapter, files };
}

function createPlugin(adapter: ReturnType<typeof memoryVault>['adapter']): ClaudianPlugin {
  const app = {
    vault: { adapter },
    workspace: {
      getLeavesOfType: jest.fn().mockReturnValue([]),
      getRightLeaf: jest.fn().mockReturnValue({ setViewState: jest.fn().mockResolvedValue(undefined) }),
      getLeftLeaf: jest.fn().mockReturnValue({ setViewState: jest.fn().mockResolvedValue(undefined) }),
      getLeaf: jest.fn().mockReturnValue({ setViewState: jest.fn().mockResolvedValue(undefined) }),
      setActiveLeaf: jest.fn(),
      revealLeaf: jest.fn(),
      on: jest.fn().mockReturnValue({}),
    },
  };
  const plugin = new ClaudianPlugin(app as never, { id: 'claudian', name: 'Claudian', version: '0.1.0' } as never);
  (plugin.loadData as jest.Mock).mockResolvedValue({});
  return plugin;
}

const SESSION = '.claudian/sessions/conv-keep.meta.json';

describe('chat reliability', () => {
  let plugin: ClaudianPlugin | null = null;

  afterEach(() => {
    plugin?.onunload();
    plugin = null;
    MockNotice.mockClear();
  });

  it('an unopened chat keeps its messages when an env change invalidates its session', async () => {
    const { adapter, files } = memoryVault({
      [SESSION]: JSON.stringify({
        id: 'conv-keep',
        providerId: 'claude',
        title: 'Nicht geöffnet',
        createdAt: 1,
        updatedAt: 2,
        sessionId: 'sdk-1',
        messages: [
          { id: 'u1', role: 'user', content: 'Frage', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'Antwort', timestamp: 2 },
        ],
      }, null, 2),
    });
    plugin = createPlugin(adapter);
    await plugin.onload();

    await plugin.applyEnvironmentVariables('provider:claude', 'ANTHROPIC_MODEL=claude-sonnet-4-5');

    const stored = JSON.parse(files.get(SESSION)!) as { sessionId: string | null; messages?: unknown[] };
    expect(stored.sessionId).toBeNull();
    expect(stored.messages).toHaveLength(2);
  });

  it('deleting moves the chat to the trash, and restoring brings it back whole', async () => {
    const { adapter, files } = memoryVault();
    plugin = createPlugin(adapter);
    await plugin.onload();
    const conversation = await plugin.createConversation();
    await plugin.updateConversation(conversation.id, {
      title: 'Wichtig',
      messages: [{ id: 'u1', role: 'user', content: 'Bitte behalten', timestamp: 1 }],
    });
    const path = `.claudian/sessions/${conversation.id}.meta.json`;
    const before = files.get(path);

    await plugin.deleteConversation(conversation.id);

    expect(plugin.getConversationList().some((c) => c.id === conversation.id)).toBe(false);
    expect(files.has(path)).toBe(false);
    expect(files.get(`.claudian/trash/${conversation.id}.meta.json`)).toBe(before);
    expect(MockNotice).toHaveBeenCalledWith(expect.stringContaining('„Wichtig“ gelöscht.'), 10_000);

    const restored = await plugin.restoreConversation(conversation.id);

    expect(restored?.title).toBe('Wichtig');
    expect(plugin.getConversationList().some((c) => c.id === conversation.id)).toBe(true);
    expect(files.get(path)).toBe(before);
  });
});
