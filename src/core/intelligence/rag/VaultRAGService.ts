import type { Vault } from 'obsidian';

import type { EmbeddingService } from '../embeddings/EmbeddingService';
import type { VectorRecord, VectorStore } from '../vectorStore/VectorStore';

export interface RAGChunk {
  id: string;
  path: string;
  text: string;
  score: number;
}

export interface VaultRAGOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  maxChunksPerFile?: number;
}

export class VaultRAGService {
  private isIndexing = false;

  constructor(
    private readonly vault: Vault,
    private readonly embeddingService: EmbeddingService,
    private readonly vectorStore: VectorStore,
    private readonly options: VaultRAGOptions = {},
  ) {}

  async indexVault(options: { limit?: number; onProgress?: (count: number) => void } = {}): Promise<number> {
    if (this.isIndexing) return 0;
    this.isIndexing = true;

    try {
      const files = this.vault.getMarkdownFiles().slice(0, options.limit ?? 1000);
      let indexed = 0;

      for (const file of files) {
        const content = await this.vault.cachedRead(file).catch(() => '');
        if (!content.trim()) continue;

        const chunks = this.chunkText(content);
        const embeddings = await this.embeddingService.embed(chunks);

        for (let i = 0; i < chunks.length; i++) {
          const record: VectorRecord = {
            id: `${file.path}#chunk-${i}`,
            text: chunks[i],
            embedding: embeddings[i],
            metadata: { path: file.path, index: i },
            mtime: file.stat.mtime,
          };
          this.vectorStore.upsert(record);
        }

        indexed += chunks.length;
        options.onProgress?.(indexed);
      }

      return indexed;
    } finally {
      this.isIndexing = false;
    }
  }

  async query(question: string, options: { limit?: number } = {}): Promise<RAGChunk[]> {
    const [embedding] = await this.embeddingService.embed([question]);
    const results = this.vectorStore.search(embedding, { limit: options.limit ?? 5 });
    return results.map(result => ({
      id: result.record.id,
      path: String(result.record.metadata.path ?? 'unknown'),
      text: result.record.text,
      score: result.score,
    }));
  }

  private chunkText(text: string): string[] {
    const size = this.options.chunkSize ?? 800;
    const overlap = this.options.chunkOverlap ?? 100;
    const maxChunks = this.options.maxChunksPerFile ?? 20;
    const chunks: string[] = [];
    let start = 0;

    while (start < text.length && chunks.length < maxChunks) {
      const end = Math.min(start + size, text.length);
      chunks.push(text.slice(start, end).trim());
      start += size - overlap;
    }

    return chunks.filter(chunk => chunk.length > 0);
  }
}
