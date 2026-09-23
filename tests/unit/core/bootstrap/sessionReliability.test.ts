import '@/providers';

import {
  SESSIONS_PATH,
  SessionStorage,
} from '@/core/bootstrap/SessionStorage';
import {
  CORRUPT_SESSIONS_PATH,
  SESSIONS_INDEX_PATH,
  TRASH_INDEX_PATH,
  TRASH_PATH,
} from '@/core/bootstrap/StoragePaths';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { Conversation, SessionMetadata } from '@/core/types';

function createMemoryAdapter(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const failList = { value: false };
  const adapter = {
    exists: jest.fn(async (path: string) => files.has(path)),
    read: jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    }),
    readHead: jest.fn(async (path: string, bytes: number) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content.slice(0, bytes);
    }),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeAtomic: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    rename: jest.fn(async (from: string, to: string) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`ENOENT ${from}`);
      if (files.has(to)) throw new Error('Destination file already exists!');
      files.delete(from);
      files.set(to, content);
    }),
    delete: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    ensureFolder: jest.fn(async () => {}),
    listFiles: jest.fn(async (folder: string) => {
      if (failList.value) throw new Error('EIO');
      return [...files.keys()].filter((path) => (
        path.startsWith(`${folder}/`)
        && !path.slice(folder.length + 1).includes('/')
        && path.endsWith('.meta.json')
      ));
    }),
    stat: jest.fn(async (path: string) => (
      files.has(path) ? { mtime: 1, size: files.get(path)!.length } : null
    )),
  } as unknown as jest.Mocked<VaultFileAdapter>;
  return { adapter, files, failList };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    providerId: 'codex',
    title: 'Firewall prüfen',
    createdAt: 1,
    updatedAt: 2,
    sessionId: null,
    messages: [],
    ...overrides,
  };
}

const MESSAGES = [
  { id: 'u1', role: 'user' as const, content: 'Prüfe die Firewall', timestamp: 1 },
  { id: 'a1', role: 'assistant' as const, content: 'Regel 12 blockiert Port 443.', timestamp: 2 },
];

function metaPath(id: string): string {
  return `${SESSIONS_PATH}/${id}.meta.json`;
}

async function seed(storage: SessionStorage, conv: Conversation): Promise<void> {
  await storage.saveMetadata(storage.toSessionMetadata(conv));
}

describe('SessionStorage reliability', () => {
  describe('saving a chat whose messages were never loaded', () => {
    it('keeps the stored messages when only header fields changed', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      await seed(storage, conversation({
        messages: MESSAGES,
        providerState: { threadId: 'thread-1' },
      }));

      // What the startup list holds: header fields only, messages not loaded.
      const [light] = await new SessionStorage(adapter).listMetadata();
      const unloaded = {
        ...light,
        providerId: 'codex',
        messages: [],
        providerState: undefined,
        _lazyMessages: true,
      } as unknown as Conversation;

      await storage.saveConversation(unloaded);

      const stored = JSON.parse(files.get(metaPath('conv-1'))!) as SessionMetadata;
      expect(stored.messages?.map((m) => m.id)).toEqual(['u1', 'a1']);
      // The header change (an invalidated native session) still lands.
      expect(stored.providerState).toBeUndefined();
    });

    it('keeps stored subagent data when the provider state is rebuilt from no messages', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      const subagentData = { 'task-1': { id: 'task-1', description: 'Suche', status: 'completed' } };
      files.set(metaPath('conv-2'), JSON.stringify({
        id: 'conv-2',
        providerId: 'claude',
        title: 'Mit Agenten',
        createdAt: 1,
        updatedAt: 2,
        sessionId: 'sdk-1',
        providerState: { providerSessionId: 'sdk-1', subagentData },
        messages: MESSAGES,
      }));

      const unloaded = conversation({
        id: 'conv-2',
        providerId: 'claude',
        title: 'Umbenannt',
        providerState: { providerSessionId: 'sdk-2' },
      });
      (unloaded as unknown as { _lazyMessages: boolean })._lazyMessages = true;

      await storage.saveConversation(unloaded);

      const stored = JSON.parse(files.get(metaPath('conv-2'))!) as SessionMetadata;
      expect(stored.title).toBe('Umbenannt');
      expect(stored.messages).toHaveLength(2);
      expect(stored.providerState?.providerSessionId).toBe('sdk-2');
      expect(stored.providerState?.subagentData).toEqual(subagentData);
    });

    it('never overwrites a stored file it cannot parse', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      files.set(metaPath('conv-3'), '{"id":"conv-3","messages":[{"id":"u1"');

      const unloaded = conversation({ id: 'conv-3' });
      (unloaded as unknown as { _lazyMessages: boolean })._lazyMessages = true;

      await storage.saveConversation(unloaded);

      expect(files.get(metaPath('conv-3'))).toBe('{"id":"conv-3","messages":[{"id":"u1"');
    });

    it('saves a loaded chat as it is', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);

      await storage.saveConversation(conversation({ messages: MESSAGES }));

      const stored = JSON.parse(files.get(metaPath('conv-1'))!) as SessionMetadata;
      expect(stored.messages).toHaveLength(2);
    });
  });

  describe('loading', () => {
    it('backs up a corrupt file before anything can overwrite it', async () => {
      const broken = '{"id":"conv-4","title":"Halb geschrieben","messages":[';
      const { adapter, files } = createMemoryAdapter({ [metaPath('conv-4')]: broken });
      const storage = new SessionStorage(adapter);

      const result = await storage.loadMetadataDetailed('conv-4');

      expect(result.status).toBe('corrupt');
      const backups = [...files.keys()].filter((path) => path.startsWith(`${CORRUPT_SESSIONS_PATH}/`));
      expect(backups).toHaveLength(1);
      expect(files.get(backups[0])).toBe(broken);
      expect(result.status === 'corrupt' && result.backupPath).toBe(backups[0]);
    });

    it('reports a missing file as missing, not corrupt', async () => {
      const storage = new SessionStorage(createMemoryAdapter().adapter);

      const result = await storage.loadMetadataDetailed('nope');

      expect(result.status).toBe('missing');
    });

    it('reports a read failure as unreadable and writes no backup', async () => {
      const { adapter, files } = createMemoryAdapter({ [metaPath('conv-5')]: '{}' });
      adapter.read.mockRejectedValueOnce(new Error('EBUSY'));
      const storage = new SessionStorage(adapter);

      const result = await storage.loadMetadataDetailed('conv-5');

      expect(result.status).toBe('unreadable');
      expect([...files.keys()].some((path) => path.startsWith(`${CORRUPT_SESSIONS_PATH}/`))).toBe(false);
    });
  });

  describe('writes', () => {
    it('writes session files and the index atomically', async () => {
      jest.useFakeTimers();
      try {
        const { adapter } = createMemoryAdapter();
        const storage = new SessionStorage(adapter);
        await storage.listMetadata();

        await seed(storage, conversation({ messages: MESSAGES }));
        await storage.flushIndex();

        expect(adapter.writeAtomic).toHaveBeenCalledWith(metaPath('conv-1'), expect.any(String));
        expect(adapter.writeAtomic).toHaveBeenCalledWith(SESSIONS_INDEX_PATH, expect.any(String));
        expect(adapter.write).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('flushIndex writes a pending index save immediately', async () => {
      jest.useFakeTimers();
      try {
        const { adapter, files } = createMemoryAdapter();
        const storage = new SessionStorage(adapter);
        await storage.listMetadata();
        await seed(storage, conversation({ messages: MESSAGES }));
        expect(files.has(SESSIONS_INDEX_PATH)).toBe(false);

        await storage.flushIndex();

        expect(JSON.parse(files.get(SESSIONS_INDEX_PATH)!)).toHaveProperty('conv-1');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('listing', () => {
    it('keeps every indexed chat when the session folder cannot be listed', async () => {
      const { adapter, files, failList } = createMemoryAdapter();
      const writer = new SessionStorage(adapter);
      await writer.listMetadata();
      await seed(writer, conversation({ id: 'a', messages: MESSAGES }));
      await seed(writer, conversation({ id: 'b', messages: MESSAGES }));
      await writer.flushIndex();
      const indexBefore = files.get(SESSIONS_INDEX_PATH);

      failList.value = true;
      const listed = await new SessionStorage(adapter).listMetadata();

      expect(listed.map((meta) => meta.id).sort()).toEqual(['a', 'b']);
      expect(files.get(SESSIONS_INDEX_PATH)).toBe(indexBefore);
    });

    it('reads title and provider of an oversized file from its head', async () => {
      const big = JSON.stringify({
        id: 'conv-big',
        providerId: 'codex',
        title: 'Großes Refactoring „Auth“',
        createdAt: 10,
        updatedAt: 20,
        lastResponseAt: 30,
        sessionId: 'thread-9',
        pinned: true,
        messages: Array.from({ length: 4000 }, (_, i) => ({
          id: `m${i}`, role: 'user', content: 'x'.repeat(200), timestamp: i,
        })),
      }, null, 2);
      const { adapter } = createMemoryAdapter({ [metaPath('conv-big')]: big });

      const [listed] = await new SessionStorage(adapter).listMetadata();

      expect(listed.title).toBe('Großes Refactoring „Auth“');
      expect(listed.providerId).toBe('codex');
      expect(listed.lastResponseAt).toBe(30);
      expect(listed.pinned).toBe(true);
      expect((listed as { _stub?: boolean })._stub).toBe(true);
      expect(adapter.read).not.toHaveBeenCalledWith(metaPath('conv-big'));
    });
  });

  describe('trash', () => {
    it('moves a deleted chat to the trash and restores it intact', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      await storage.listMetadata();
      await seed(storage, conversation({ messages: MESSAGES, title: 'Behalten' }));
      const original = files.get(metaPath('conv-1'));

      await storage.moveToTrash('conv-1', { deletedAt: 1_000 });

      expect(files.has(metaPath('conv-1'))).toBe(false);
      expect(files.get(`${TRASH_PATH}/conv-1.meta.json`)).toBe(original);
      expect((await storage.listMetadata()).map((meta) => meta.id)).toEqual([]);
      expect(await storage.listTrash()).toEqual([
        expect.objectContaining({ id: 'conv-1', title: 'Behalten', deletedAt: 1_000 }),
      ]);

      const restored = await storage.restoreFromTrash('conv-1');

      expect(restored?.title).toBe('Behalten');
      expect(files.get(metaPath('conv-1'))).toBe(original);
      expect(await storage.listTrash()).toEqual([]);
      expect((await storage.listMetadata()).map((meta) => meta.id)).toEqual(['conv-1']);
    });

    it('purges only entries older than the retention and reports each one', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      await storage.listMetadata();
      await seed(storage, conversation({ id: 'old', messages: MESSAGES }));
      await seed(storage, conversation({ id: 'fresh', messages: MESSAGES }));
      await storage.moveToTrash('old', { deletedAt: 1_000 });
      await storage.moveToTrash('fresh', { deletedAt: 9_000 });
      const purged: string[] = [];

      await storage.purgeTrash({
        now: 10_000,
        maxAgeMs: 5_000,
        onPurge: async (meta) => { purged.push(meta.id); },
      });

      expect(purged).toEqual(['old']);
      expect(files.has(`${TRASH_PATH}/old.meta.json`)).toBe(false);
      expect(files.has(`${TRASH_PATH}/fresh.meta.json`)).toBe(true);
      expect(JSON.parse(files.get(TRASH_INDEX_PATH)!)).not.toHaveProperty('old');
    });
  });

  describe('background compaction', () => {
    it('does not overwrite a save that landed while it was compacting', async () => {
      const oversized = JSON.stringify({
        id: 'conv-c',
        createdAt: 1,
        updatedAt: 1,
        messages: [{
          id: 'a1',
          role: 'assistant',
          content: 'alt',
          timestamp: 1,
          toolCalls: [{ id: 't', name: 'Read', input: {}, status: 'completed', result: 'r'.repeat(600_000) }],
        }],
      });
      const { adapter, files } = createMemoryAdapter({ [metaPath('conv-c')]: oversized });
      const storage = new SessionStorage(adapter);
      const newer = conversation({ id: 'conv-c', messages: [...MESSAGES, { id: 'u2', role: 'user', content: 'neu', timestamp: 3 }] });
      // A tab saves the chat between compaction's read and its write.
      adapter.read.mockImplementationOnce(async (path: string) => {
        const content = files.get(path)!;
        void seed(storage, newer);
        return content;
      });

      await storage.compactOversizedMetadata({ yieldBetweenFiles: async () => {} });

      const stored = JSON.parse(files.get(metaPath('conv-c'))!) as SessionMetadata;
      expect(stored.messages?.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
    });
  });

  describe('review regressions', () => {
    it('merges only what a listing stub knows onto a large file', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      files.set(metaPath('big'), JSON.stringify({
        id: 'big',
        providerId: 'codex',
        title: 'Groß',
        createdAt: 1,
        updatedAt: 2,
        sessionId: 'thread-9',
        providerState: { threadId: 'thread-9' },
        goal: 'Weiter so',
        usage: { contextTokens: 10, contextWindow: 100, percentage: 10, inputTokens: 10 },
        pendingContextBootstrap: 'carry',
        messages: MESSAGES,
      }));
      const stub = {
        id: 'big', providerId: 'codex', title: 'Groß', createdAt: 1, updatedAt: 3, sessionId: null, messages: [],
        _lazyMessages: true, _stub: true,
      } as unknown as Conversation;

      await storage.saveConversation(stub);

      const stored = JSON.parse(files.get(metaPath('big'))!) as SessionMetadata;
      expect(stored.providerState).toEqual({ threadId: 'thread-9' });
      expect(stored.goal).toBe('Weiter so');
      expect(stored.usage?.percentage).toBe(10);
      expect(stored.pendingContextBootstrap).toBe('carry');
      expect(stored.messages).toHaveLength(2);
      // What the stub does know still lands (here: an invalidated session).
      expect(stored.sessionId).toBeNull();
      expect(stored.updatedAt).toBe(3);
    });

    it('does not create an empty file for a listed chat whose file is briefly missing', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      const unloaded = conversation({ id: 'gone' });
      Object.assign(unloaded, { _lazyMessages: true, _messageCount: 12 });

      const outcome = await storage.saveConversation(unloaded);

      expect(outcome).toBe('skipped');
      expect(files.has(metaPath('gone'))).toBe(false);
    });

    it('never lets compaction overwrite a save that was still being written', async () => {
      const oversized = JSON.stringify({
        id: 'conv-c', createdAt: 1, updatedAt: 1,
        messages: [{ id: 'a1', role: 'assistant', content: 'alt', timestamp: 1,
          toolCalls: [{ id: 't', name: 'Read', input: {}, status: 'completed', result: 'r'.repeat(600_000) }] }],
      });
      const { adapter, files } = createMemoryAdapter({ [metaPath('conv-c')]: oversized });
      let finishSave!: () => void;
      const storage = new SessionStorage(adapter);
      // The save's write is in flight (not landed) while compaction reads.
      adapter.writeAtomic.mockImplementationOnce((path: string, content: string) => new Promise<void>((resolve) => {
        finishSave = () => { files.set(path, content); resolve(); };
      }));
      const newer = conversation({ id: 'conv-c', messages: [...MESSAGES] });
      const saving = storage.saveMetadata(storage.toSessionMetadata(newer));

      const compacting = storage.compactOversizedMetadata({ yieldBetweenFiles: async () => {} });
      await new Promise((resolve) => setTimeout(resolve, 0));
      finishSave();
      await Promise.all([saving, compacting]);

      const stored = JSON.parse(files.get(metaPath('conv-c'))!) as SessionMetadata;
      expect(stored.messages?.map((m) => m.id)).toEqual(['u1', 'a1']);
    });

    it('keeps every entry when two chats are trashed at the same time', async () => {
      const { adapter } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      await storage.listMetadata();
      await seed(storage, conversation({ id: 'a', messages: MESSAGES }));
      await seed(storage, conversation({ id: 'b', messages: MESSAGES }));

      await Promise.all([storage.moveToTrash('a'), storage.moveToTrash('b')]);

      expect((await storage.listTrash()).map((entry) => entry.id).sort()).toEqual(['a', 'b']);
    });

    it('ignores a late save of a chat that was already trashed', async () => {
      const { adapter, files } = createMemoryAdapter();
      const storage = new SessionStorage(adapter);
      await storage.listMetadata();
      await seed(storage, conversation({ id: 'a', messages: MESSAGES }));
      await storage.moveToTrash('a');

      await seed(storage, conversation({ id: 'a', messages: MESSAGES }));

      expect(files.has(metaPath('a'))).toBe(false);
      expect(await storage.restoreFromTrash('a')).not.toBeNull();
    });

    it('backs a corrupt file up once, not on every start', async () => {
      const broken = '{"id":"x","messages":[';
      const { adapter, files } = createMemoryAdapter({ [metaPath('x')]: broken });

      await new SessionStorage(adapter).loadMetadataDetailed('x');
      await new SessionStorage(adapter).loadMetadataDetailed('x');

      expect([...files.keys()].filter((path) => path.startsWith(`${CORRUPT_SESSIONS_PATH}/`))).toHaveLength(1);
    });

    it('writes the pin before bulky provider state, so a large file\'s head still shows it', () => {
      const storage = new SessionStorage(createMemoryAdapter().adapter);
      const meta = storage.toSessionMetadata(conversation({ pinned: true, providerState: { threadId: 't' } }));

      const keys = Object.keys(meta);
      expect(keys.indexOf('pinned')).toBeLessThan(keys.indexOf('providerState'));
    });
  });
});
