import { SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function createMemoryAdapter() {
  const files = new Map<string, string>();
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
  return adapter;
}

describe('pending context carry survives reload', () => {
  it('keeps a carry longer than 500 characters in the metadata the next launch reads', async () => {
    const marker = 'RELOADED-CARRY-MARKER';
    const pendingContextBootstrap = `<conversation_context>\n${marker}\n${'q'.repeat(800)}\n</conversation_context>`;
    const adapter = createMemoryAdapter();
    const storage = new SessionStorage(adapter);

    await storage.saveMetadata({
      id: 'conv-carry',
      providerId: 'claude',
      title: 'Switched chat',
      createdAt: 1,
      updatedAt: 2,
      pendingContextBootstrap,
      messages: [{ id: 'u1', role: 'user', content: 'hello', timestamp: 1 }],
    });

    const reloaded = new SessionStorage(adapter);
    const listed = await reloaded.listMetadata();
    const loaded = await reloaded.loadMetadata('conv-carry');

    expect(pendingContextBootstrap.length).toBeGreaterThan(500);
    expect(listed.find((item) => item.id === 'conv-carry')?.pendingContextBootstrap).toBe(pendingContextBootstrap);
    expect(loaded?.pendingContextBootstrap).toBe(pendingContextBootstrap);
  });
});
