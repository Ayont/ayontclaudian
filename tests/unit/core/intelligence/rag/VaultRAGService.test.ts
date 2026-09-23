import type { Vault } from 'obsidian';

import type { EmbeddingService } from '../../../../../src/core/intelligence/embeddings/EmbeddingService';
import { VaultRAGService } from '../../../../../src/core/intelligence/rag/VaultRAGService';
import { VectorStore } from '../../../../../src/core/intelligence/vectorStore/VectorStore';

class FakeEmbeddingService implements EmbeddingService {
  getDimension(): number { return 3; }
  async isAvailable(): Promise<boolean> { return true; }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => {
      const base = text.toLowerCase();
      if (base.includes('obsidian')) return [1, 0, 0];
      if (base.includes('plugin')) return [0, 1, 0];
      return [0, 0, 1];
    });
  }
}

function createVault(files: Array<{ path: string; content: string }>): Vault {
  return {
    getMarkdownFiles: () => files.map(f => ({
      path: f.path,
      basename: f.path.replace('.md', ''),
      stat: { mtime: Date.now() },
    })),
    cachedRead: async (file: { path: string }) => {
      const found = files.find(f => f.path === file.path);
      return found ? found.content : '';
    },
  } as unknown as Vault;
}

describe('VaultRAGService', () => {
  it('indexes vault files and answers queries', async () => {
    const vault = createVault([
      { path: 'obsidian.md', content: 'Obsidian is a powerful knowledge base.' },
      { path: 'plugin.md', content: 'Plugins extend Obsidian functionality.' },
    ]);
    const embeddings = new FakeEmbeddingService();
    const store = new VectorStore();
    const rag = new VaultRAGService(vault, embeddings, store);

    const indexed = await rag.indexVault();
    expect(indexed).toBeGreaterThan(0);

    const results = await rag.query('tell me about obsidian');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('obsidian.md');
  });

  // Regression: this runs from `onLayoutReady` in the Electron RENDERER, on the
  // same thread that paints Obsidian. A tight loop over every markdown file
  // (chunk + embed per file) never returns to the event loop, so the window
  // freezes for the whole pass — on a 340-note vault that is the difference
  // between a normal start and "Workspace wird geladen…" sitting there.
  it('returns to the event loop between files so the UI can paint', async () => {
    const files = Array.from({ length: 8 }, (_, i) => ({
      path: `note-${i}.md`,
      content: `Obsidian note number ${i}.`,
    }));
    const rag = new VaultRAGService(createVault(files), new FakeEmbeddingService(), new VectorStore());

    // A macrotask scheduled before indexing starts must get to run WHILE the
    // pass is still going. Without a yield it can only run after everything.
    let ranDuringIndexing = false;
    let indexingFinished = false;
    setTimeout(() => { ranDuringIndexing = !indexingFinished; }, 0);

    await rag.indexVault();
    indexingFinished = true;

    expect(ranDuringIndexing).toBe(true);
  });

  it('reports how far it got when embedding fails midway', async () => {
    const failing: EmbeddingService = {
      getDimension: () => 3,
      isAvailable: async () => true,
      embed: async () => { throw new Error('Ollama unreachable'); },
    };
    const rag = new VaultRAGService(
      createVault([{ path: 'a.md', content: 'Obsidian note.' }]),
      failing,
      new VectorStore(),
    );

    await expect(rag.indexVault()).resolves.toBe(0);
  });
});

// The persisted index is ~20 MB of JSON; parsing it 2.5 s after start froze
// Obsidian right when the user began to work. It now loads on first use.
describe('VaultRAGService lazy index', () => {
  it('loads the persisted index once, before the first query or update', async () => {
    const vault = createVault([{ path: 'obsidian.md', content: 'Obsidian notes.' }]);
    const store = new VectorStore();
    const ensureLoaded = jest.fn(async () => {
      store.upsert({ id: 'old.md#chunk-0', text: 'Obsidian base', embedding: [1, 0, 0], metadata: { path: 'old.md', index: 0 }, mtime: 1 });
    });
    const rag = new VaultRAGService(vault, new FakeEmbeddingService(), store, { ensureLoaded });

    const results = await rag.query('obsidian');
    await rag.query('obsidian again');

    expect(ensureLoaded).toHaveBeenCalledTimes(1);
    expect(results[0].path).toBe('old.md');
  });

  it('applies an edit made before the index loaded on top of it, not under it', async () => {
    const vault = createVault([{ path: 'plugin.md', content: 'A plugin note.' }]);
    const store = new VectorStore();
    let release!: () => void;
    const ensureLoaded = jest.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const rag = new VaultRAGService(vault, new FakeEmbeddingService(), store, { ensureLoaded });

    const pending = rag.indexFile({ path: 'plugin.md', extension: 'md', stat: { mtime: 2 } } as never);
    for (let i = 0; i < 5 && !release; i++) await Promise.resolve();
    expect(store.size()).toBe(0);
    release();
    await pending;

    expect(store.getAll().map(record => record.metadata.path)).toEqual(['plugin.md']);
  });
});
