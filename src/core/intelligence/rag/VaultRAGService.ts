import type { TFile, Vault } from 'obsidian';

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
        let embeddings: number[][];
        try {
          embeddings = await this.embeddingService.embed(chunks);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[VaultRAGService] embedding failed during index:', message);
          return indexed;
        }

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

  /**
   * (Re-)indexes a single markdown file: drops its previous chunks and embeds
   * the current content. Used for incremental, live index updates as the vault
   * changes, so RAG stays fresh without a full re-index.
   */
  async indexFile(file: TFile): Promise<number> {
    if (file.extension !== 'md') return 0;
    this.removeFile(file.path);

    const content = await this.vault.cachedRead(file).catch(() => '');
    if (!content.trim()) return 0;

    const chunks = this.chunkText(content);
    if (chunks.length === 0) return 0;

    let embeddings: number[][];
    try {
      embeddings = await this.embeddingService.embed(chunks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[VaultRAGService] embedding failed during incremental index:', message);
      return 0;
    }

    for (let i = 0; i < chunks.length; i++) {
      this.vectorStore.upsert({
        id: `${file.path}#chunk-${i}`,
        text: chunks[i],
        embedding: embeddings[i],
        metadata: { path: file.path, index: i },
        mtime: file.stat.mtime,
      });
    }
    return chunks.length;
  }

  /** Removes every chunk belonging to a file path from the index. */
  removeFile(path: string): void {
    for (const record of this.vectorStore.getAll()) {
      if (record.metadata.path === path) {
        this.vectorStore.delete(record.id);
      }
    }
  }

  /** True while a full index is running (used to avoid overlapping work). */
  get indexing(): boolean {
    return this.isIndexing;
  }

  async query(question: string, options: { limit?: number } = {}): Promise<RAGChunk[]> {
    try {
      const [embedding] = await this.embeddingService.embed([question]);
      const results = this.vectorStore.search(embedding, { limit: options.limit ?? 5 });
      return results.map(result => ({
        id: result.record.id,
        path: String(result.record.metadata.path ?? 'unknown'),
        text: result.record.text,
        score: result.score,
      }));
    } catch (error) {
      // Defensive: if the configured embedding service (e.g. Ollama) fails at
      // query time, surface a notice but do not break the chat send flow.
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[VaultRAGService] query failed:', message);
      return [];
    }
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
