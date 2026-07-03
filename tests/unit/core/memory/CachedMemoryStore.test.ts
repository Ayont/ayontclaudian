import { globalEventBus } from '@/core/events/EventBus';
import { CachedMemoryStore } from '@/core/memory/CachedMemoryStore';
import type { MemoryNote } from '@/core/memory/memoryService';
import { loadMemoryNotes } from '@/core/memory/memoryService';

jest.mock('@/core/memory/memoryService');
const mockedLoad = loadMemoryNotes as jest.MockedFunction<typeof loadMemoryNotes>;

/** Minimal fake Obsidian Events that records handlers and can trigger them. */
function createFakeEvents() {
  const handlers = new Map<string, Array<(...args: unknown[]) => unknown>>();
  let refCounter = 0;
  return {
    on(name: string, cb: (...args: unknown[]) => unknown): { id: number } {
      const list = handlers.get(name) ?? [];
      list.push(cb);
      handlers.set(name, list);
      return { id: ++refCounter };
    },
    offref(_ref: { id: number }): void {
      // no-op (handlers are detached logically by dispose clearing refs)
    },
    trigger(name: string, ...args: unknown[]): void {
      for (const cb of handlers.get(name) ?? []) cb(...args);
    },
  };
}

function makeNote(topic: string): MemoryNote {
  return { path: `.claudian/memory/${topic}.md`, topic, content: `about ${topic}`, tags: [], mtime: 1 };
}

describe('CachedMemoryStore', () => {
  afterEach(() => {
    mockedLoad.mockReset();
    globalEventBus.clear();
  });

  it('caches notes within the TTL window (does not rescan the vault each call)', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    await store.getNotes('.claudian/memory');
    await store.getNotes('.claudian/memory');

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('reloads after the TTL expires', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 0); // TTL = 0ms => always stale

    await store.getNotes('.claudian/memory');
    await store.getNotes('.claudian/memory');

    expect(mockedLoad).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('dedupes concurrent in-flight loads for the same folder', async () => {
    let resolveLoad: (notes: MemoryNote[]) => void = () => {};
    mockedLoad.mockImplementation(() => new Promise(resolve => { resolveLoad = resolve; }));
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    const p1 = store.getNotes('.claudian/memory');
    const p2 = store.getNotes('.claudian/memory');
    const p3 = store.getNotes('.claudian/memory');

    resolveLoad([makeNote('a')]);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    store.dispose();
  });

  it('caches each folder independently', async () => {
    mockedLoad.mockImplementation(async (_vault, folder) =>
      folder.endsWith('memory') ? [makeNote('mem')] : [makeNote('project')],
    );
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    await store.getNotes('.claudian/projects/x');

    // Two distinct folders => two loads.
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    // Repeating each folder hits the cache.
    await store.getNotes('.claudian/memory');
    await store.getNotes('.claudian/projects/x');
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('invalidates a folder when a vault modify event touches a file under it', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    expect(mockedLoad).toHaveBeenCalledTimes(1);

    // Simulate Obsidian firing `modify` for a memory file.
    events.trigger('modify', { path: '.claudian/memory/a.md' });

    await store.getNotes('.claudian/memory');
    expect(mockedLoad).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('does NOT invalidate when an event touches an unrelated path', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    events.trigger('create', { path: 'some/other/note.md' });
    await store.getNotes('.claudian/memory');

    expect(mockedLoad).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('invalidate(folder) forces the next getNotes to reload', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    store.invalidate('.claudian/memory');
    await store.getNotes('.claudian/memory');

    expect(mockedLoad).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('clears the whole cache on a memory:updated event bus signal', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    globalEventBus.emit('memory:updated', { id: 'a', topic: 'a' });
    await store.getNotes('.claudian/memory');

    expect(mockedLoad).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it('dispose() stops reacting to subsequent events', async () => {
    mockedLoad.mockResolvedValue([makeNote('a')]);
    const events = createFakeEvents();
    const store = new CachedMemoryStore({} as never, events as never, 10_000);

    await store.getNotes('.claudian/memory');
    store.dispose();
    events.trigger('modify', { path: '.claudian/memory/a.md' });
    globalEventBus.emit('memory:updated', {});

    // After dispose, no handlers should throw and the call still returns notes
    // (a fresh load, since dispose also cleared the cache).
    await store.getNotes('.claudian/memory');
    expect(mockedLoad).toHaveBeenCalled();
  });
});
