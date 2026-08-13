import type { EmbeddingService } from './EmbeddingService';

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  /** Per-request deadline. See DEFAULT_TIMEOUT_MS for why this is not optional in spirit. */
  timeoutMs?: number;
}

/**
 * Deadline for every request to Ollama.
 *
 * `isAvailable()` is awaited from `onLayoutReady`, and Obsidian's workspace load
 * waits on that callback — so a probe with no deadline is a vault that never
 * finishes loading. A refused connection fails fast, but a port that ACCEPTS and
 * then never answers (Ollama still starting, a stale listener, a proxy in front)
 * hangs `fetch` indefinitely. That is not hypothetical: it is exactly the state
 * a machine is in while Ollama boots.
 *
 * Two seconds is generous for a localhost round-trip and short enough that a
 * dead server costs a blink instead of the session.
 */
const DEFAULT_TIMEOUT_MS = 2_000;

/** Embedding a chunk is real work, so it gets a longer — but still finite — leash. */
const DEFAULT_EMBED_TIMEOUT_MS = 30_000;

export class OllamaEmbeddingProvider implements EmbeddingService {
  constructor(private readonly config: OllamaEmbeddingConfig) {}

  private async fetchWithDeadline(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithDeadline(
        `${this.config.baseUrl}/api/tags`,
        { method: 'GET' },
        this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (!response.ok) {
        return false;
      }
      const data = await response.json() as { models?: Array<{ name?: string }> };
      const models = data.models ?? [];
      return models.some((m) => (m.name ?? '').startsWith(this.config.model));
    } catch {
      // Includes the abort: an unreachable or unresponsive server is simply
      // "not available", and the keyword provider carries the feature instead.
      return false;
    }
  }

  getDimension(): number {
    return 768; // nomic-embed-text default
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const response = await this.fetchWithDeadline(
        `${this.config.baseUrl}/api/embeddings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: this.config.model, prompt: text }),
        },
        this.config.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS,
      );
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
