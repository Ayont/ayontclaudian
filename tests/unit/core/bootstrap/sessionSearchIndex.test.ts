import '@/providers';

import { SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import { SESSIONS_INDEX_PATH } from '@/core/bootstrap/StoragePaths';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { Conversation } from '@/core/types';

function createMemoryAdapter(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const adapter = {
    exists: jest.fn(async (path: string) => files.has(path)),
    read: jest.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT ${path}`);
      return content;
    }),
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    delete: jest.fn(async (path: string) => {
      files.delete(path);
    }),
    listFiles: jest.fn(async (folder: string) => (
      folder === SESSIONS_PATH
        ? [...files.keys()].filter((path) => path.startsWith(`${SESSIONS_PATH}/`) && path.endsWith('.meta.json'))
        : []
    )),
    stat: jest.fn(async (path: string) => (
      files.has(path) ? { mtime: 1, size: files.get(path)!.length } : null
    )),
  } as unknown as jest.Mocked<VaultFileAdapter>;
  return { adapter, files };
}

const withEnvelope = '<vault_context>\nRelevant vault notes\n</vault_context>\n\nFirewall-Regeln für CERTUSS prüfen';

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    providerId: 'claude',
    title: 'CERTUSS Firewall',
    createdAt: 1,
    updatedAt: 2,
    sessionId: null,
    messages: [],
    ...overrides,
  };
}

describe('session search index', () => {
  it('lists a clean preview and content index from the saved messages', async () => {
    const { adapter } = createMemoryAdapter();
    const storage = new SessionStorage(adapter);
    await storage.saveMetadata(storage.toSessionMetadata(conversation({
      messages: [
        { id: 'u1', role: 'user', content: withEnvelope, timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Die Regel 12 blockiert Port 443.', timestamp: 2 },
      ],
    })));

    const [listed] = await new SessionStorage(adapter).listMetadata();

    expect(listed.searchIndex?.preview).toBe('Firewall-Regeln für CERTUSS prüfen');
    expect(listed.searchIndex?.text).toContain('Port 443');
    expect((listed as { _preview?: string })._preview).toBe('Firewall-Regeln für CERTUSS prüfen');
  });

  // A chat saved without its messages in memory (pin, rename, title) must not
  // lose the index it already has.
  it('keeps the stored index when the chat is saved without its messages loaded', () => {
    const storage = new SessionStorage(createMemoryAdapter().adapter);
    const searchIndex = { preview: 'alt', text: 'alt' };

    const meta = storage.toSessionMetadata(conversation({ searchIndex, pinned: true }));

    expect(meta.searchIndex).toEqual(searchIndex);
  });

  it('rebuilds the index from the loaded messages', () => {
    const storage = new SessionStorage(createMemoryAdapter().adapter);

    const meta = storage.toSessionMetadata(conversation({
      searchIndex: { preview: 'veraltet', text: 'veraltet' },
      messages: [{ id: 'u1', role: 'user', content: 'Neue Frage', timestamp: 1 }],
    }));

    expect(meta.searchIndex?.preview).toBe('Neue Frage');
  });

  it('backfills entries an older build indexed without a search index', async () => {
    const saved = {
      id: 'conv-old',
      providerId: 'claude',
      title: 'Alter Chat',
      createdAt: 1,
      updatedAt: 1,
      messages: [{ id: 'u1', role: 'user', content: 'Fax-Fehler bei C. Beuthel', timestamp: 1 }],
    };
    const { adapter } = createMemoryAdapter({
      [`${SESSIONS_PATH}/conv-old.meta.json`]: JSON.stringify(saved),
      [SESSIONS_INDEX_PATH]: JSON.stringify({
        'conv-old': { id: 'conv-old', providerId: 'claude', title: 'Alter Chat', createdAt: 1, updatedAt: 1, messages: [], _messageCount: 1, _preview: '' },
      }),
    });
    const storage = new SessionStorage(adapter);
    await storage.listMetadata();

    const updated = await storage.backfillSearchIndexes();

    expect(updated).toEqual([{ id: 'conv-old', searchIndex: expect.objectContaining({ preview: 'Fax-Fehler bei C. Beuthel' }) }]);
    const [listed] = await storage.listMetadata();
    expect(listed.searchIndex?.preview).toBe('Fax-Fehler bei C. Beuthel');
  });

  it('records an index for a chat without rewriting its file', async () => {
    const { adapter, files } = createMemoryAdapter();
    const storage = new SessionStorage(adapter);
    await storage.saveMetadata(storage.toSessionMetadata(conversation()));
    await storage.listMetadata();
    const before = files.get(`${SESSIONS_PATH}/conv-1.meta.json`);

    storage.rememberSearchIndex('conv-1', { preview: 'aus dem Transkript', text: 'aus dem Transkript' });

    const [listed] = await storage.listMetadata();
    expect(listed.searchIndex?.preview).toBe('aus dem Transkript');
    expect(files.get(`${SESSIONS_PATH}/conv-1.meta.json`)).toBe(before);
  });
});
