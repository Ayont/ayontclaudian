import type { EmbeddingService } from './EmbeddingService';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
}

export class OllamaEmbeddingProvider implements EmbeddingService {
  constructor(private readonly config: OllamaEmbeddingConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, { method: 'GET' });
      if (!response.ok) {
        return false;
      }
      const data = await response.json() as { models?: Array<{ name?: string }> };
      const models = data.models ?? [];
      return models.some((m) => (m.name ?? '').startsWith(this.config.model));
    } catch {
      return false;
    }
  }

  getDimension(): number {
    return 768; // nomic-embed-text default
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt: text }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Ollama embedding failed (${response.status} ${response.statusText}): ${body}`);
      }
      const data = await response.json() as { embedding: number[] };
      results.push(data.embedding);
    }
    return results;
  }
}
