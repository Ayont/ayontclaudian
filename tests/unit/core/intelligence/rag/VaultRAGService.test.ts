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
});
