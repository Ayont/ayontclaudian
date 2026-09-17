import { SESSIONS_PATH, SessionStorage } from '@/core/bootstrap/SessionStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

const SMALL = 1_000;
const OVERSIZED = 600_000;

function createAdapter(files: Record<string, { size: number; content?: string }>) {
  const written: Record<string, string> = {};
  const adapter = {
    exists: jest.fn(async (path: string) => path in files || path in written),
    read: jest.fn(async (path: string) => {
      if (path in written) return written[path];
      const file = files[path];
      if (!file) throw new Error(`ENOENT ${path}`);
      return file.content ?? 'x'.repeat(file.size);
    }),
    write: jest.fn(async (path: string, content: string) => {
      written[path] = content;
    }),
    delete: jest.fn(async () => {}),
    listFiles: jest.fn(async (folder: string) =>
      folder === SESSIONS_PATH ? Object.keys(files) : []),
    stat: jest.fn(async (path: string) =>
      path in files ? { mtime: 1_700_000_000, size: files[path].size } : null),
  } as unknown as jest.Mocked<VaultFileAdapter>;
  return { adapter, written };
}

const noYield = { yieldBetweenFiles: async () => {} };

/**
 * Regression guard for the startup cost of session compaction.
 *
 * Measured on a real vault: 435 session files / 231 MB, of which 84 files /
 * 195 MB sit above the oversize threshold. The original pass read EVERY file in
 * full just to look at `content.length`, and re-read the already-compacted ones
 * on every launch while reclaiming nothing — so a steady-state vault paid
 * ~231 MB of disk reads plus JSON parsing on the renderer thread at each start.
 */
describe('SessionStorage.compactOversizedMetadata — startup cost', () => {

  it('never reads a file that stat already proves is under the threshold', async () => {
    const files: Record<string, { size: number }> = {};
    for (let i = 0; i < 50; i++) {
      files[`${SESSIONS_PATH}/small-${i}.meta.json`] = { size: SMALL };
    }
    const { adapter } = createAdapter(files);
    const storage = new SessionStorage(adapter);

    await storage.compactOversizedMetadata(noYield);

    expect(adapter.stat).toHaveBeenCalledTimes(50);
    expect(adapter.read).not.toHaveBeenCalled();
  });

  it('does not re-read an oversized file that a previous pass already minimized', async () => {
    // Already compacted: messages are persisted-shape, so a rewrite reclaims nothing.
    const minimal = JSON.stringify({
      id: 'conv-1',
      createdAt: 1,
      updatedAt: 2,
      messages: [],
    });
    const path = `${SESSIONS_PATH}/big.meta.json`;
    const { adapter } = createAdapter({ [path]: { size: OVERSIZED, content: minimal } });
    const storage = new SessionStorage(adapter);

    await storage.compactOversizedMetadata(noYield);
    const readsAfterFirstPass = adapter.read.mock.calls.length;
    expect(readsAfterFirstPass).toBeGreaterThan(0);

    await storage.compactOversizedMetadata(noYield);

    expect(adapter.read.mock.calls.length).toBe(readsAfterFirstPass);
  });

  it('still compacts an oversized file that has real slack to reclaim', async () => {
    const bloated = JSON.stringify({
      id: 'conv-2',
      createdAt: 1,
      updatedAt: 2,
      messages: [{
        id: 'm1',
        role: 'assistant',
        content: 'hello',
        timestamp: 1,
        toolCalls: [{
          id: 't1',
          name: 'Read',
          input: {},
          status: 'completed',
          result: 'y'.repeat(OVERSIZED),
        }],
      }],
    });
    const path = `${SESSIONS_PATH}/bloated.meta.json`;
    const { adapter, written } = createAdapter({ [path]: { size: bloated.length, content: bloated } });
    const storage = new SessionStorage(adapter);

    const reclaimed = await storage.compactOversizedMetadata(noYield);

    expect(reclaimed).toBeGreaterThan(0);
    expect(written[path].length).toBeLessThan(bloated.length);
  });

  it('re-checks a file whose size changed since it was marked minimal', async () => {
    const minimal = JSON.stringify({ id: 'c', createdAt: 1, updatedAt: 2, messages: [] });
    const path = `${SESSIONS_PATH}/grows.meta.json`;
    const files = { [path]: { size: OVERSIZED, content: minimal } };
    const { adapter } = createAdapter(files);
    const storage = new SessionStorage(adapter);

    await storage.compactOversizedMetadata(noYield);
    const afterFirst = adapter.read.mock.calls.length;

    // The conversation continued: the file grew, so it must be looked at again.
    files[path].size = OVERSIZED * 2;
    await storage.compactOversizedMetadata(noYield);

    expect(adapter.read.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('survives an adapter without stat rather than skipping compaction entirely', async () => {
    const path = `${SESSIONS_PATH}/legacy.meta.json`;
    const { adapter } = createAdapter({ [path]: { size: OVERSIZED } });
    (adapter as unknown as { stat?: unknown }).stat = undefined;
    const storage = new SessionStorage(adapter);

    await expect(storage.compactOversizedMetadata(noYield)).resolves.toBeGreaterThanOrEqual(0);
    expect(adapter.read).toHaveBeenCalled();
  });
});

describe('SessionStorage.listMetadata — startup cost', () => {
  it('does not read an oversized session file just to list it', async () => {
    const smallPath = `${SESSIONS_PATH}/small.meta.json`;
    const bigPath = `${SESSIONS_PATH}/big.meta.json`;
    const small = JSON.stringify({ id: 'small', title: 'Small talk', createdAt: 1, updatedAt: 2 });
    const big = JSON.stringify({ id: 'big', title: 'Huge talk', createdAt: 1, updatedAt: 2 });
    const { adapter } = createAdapter({
      [smallPath]: { size: SMALL, content: small },
      [bigPath]: { size: OVERSIZED, content: big },
    });
    const storage = new SessionStorage(adapter);

    const metas = await storage.listMetadata();
    storage.resetIndexCache();

    expect(metas.map((meta) => meta.id).sort()).toEqual(['big', 'small']);
    expect(metas.find((meta) => meta.id === 'small')?.title).toBe('Small talk');
    expect(adapter.read).toHaveBeenCalledTimes(1);
    expect(adapter.read).toHaveBeenCalledWith(smallPath);
    expect((metas.find((meta) => meta.id === 'big') as { _lazyMessages?: boolean } | undefined)?._lazyMessages).toBe(true);
  });

  it('still reads a small file so the history title is real', async () => {
    const path = `${SESSIONS_PATH}/note.meta.json`;
    const { adapter } = createAdapter({
      [path]: {
        size: SMALL,
        content: JSON.stringify({ id: 'note', title: 'Standup', createdAt: 1, updatedAt: 2 }),
      },
    });
    const storage = new SessionStorage(adapter);

    const metas = await storage.listMetadata();
    storage.resetIndexCache();

    expect(metas).toHaveLength(1);
    expect(metas[0].title).toBe('Standup');
    expect(adapter.read).toHaveBeenCalledWith(path);
  });
});
