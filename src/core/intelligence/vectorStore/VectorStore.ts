import { cosineSimilarity } from '../embeddings/EmbeddingService';

export interface VectorRecord {
  id: string;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  mtime: number;
}

export interface VectorSearchResult {
  record: VectorRecord;
  score: number;
}

export class VectorStore {
  private records = new Map<string, VectorRecord>();

  upsert(record: VectorRecord): void {
    this.records.set(record.id, record);
  }

  delete(id: string): void {
    this.records.delete(id);
  }

  search(query: number[], options: { limit?: number; minScore?: number } = {}): VectorSearchResult[] {
    const limit = options.limit ?? 5;
    const minScore = options.minScore ?? 0;

    const results: VectorSearchResult[] = [];
    for (const record of this.records.values()) {
      const score = cosineSimilarity(query, record.embedding);
      if (score >= minScore) {
        results.push({ record, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getAll(): VectorRecord[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }

  size(): number {
    return this.records.size;
  }

  /** Embedding dimension of the stored vectors (0 when empty). */
  dimension(): number {
    for (const record of this.records.values()) {
      return record.embedding.length;
    }
    return 0;
  }

  serialize(): string {
    // Envelope carries the embedding dimension so a loader can detect a model
    // change (e.g. keyword 256-dim → Ollama 768-dim) and force a re-index
    // instead of silently comparing incompatible vectors.
    return JSON.stringify({
      version: 1,
      dimension: this.dimension(),
      records: Array.from(this.records.values()),
    });
  }

  load(serialized: string): void {
    const parsed = JSON.parse(serialized) as VectorRecord[] | { version?: number; records?: VectorRecord[] };
    // Back-compat: older indexes were a bare array of records.
    const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
    this.records.clear();
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }
}
