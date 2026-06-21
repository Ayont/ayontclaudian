import { cosineSimilarity } from '../../../../../src/core/intelligence/embeddings/EmbeddingService';
import { KeywordEmbeddingProvider } from '../../../../../src/core/intelligence/embeddings/KeywordEmbeddingProvider';

describe('KeywordEmbeddingProvider', () => {
  it('embeds texts as sparse keyword vectors', async () => {
    const provider = new KeywordEmbeddingProvider(128);
    const [a, b] = await provider.embed(['obsidian plugin', 'obsidian vault']);
    expect(a.length).toBe(128);
    expect(b.length).toBe(128);
    const score = cosineSimilarity(a, b);
    expect(score).toBeGreaterThan(0);
  });

  it('reports itself available', async () => {
    const provider = new KeywordEmbeddingProvider();
    expect(await provider.isAvailable()).toBe(true);
  });

  it('cosineSimilarity returns 0 for mismatched dimensions (no NaN)', () => {
    // Regression: vectors from different embedding models (256 vs 768 dim) must
    // not silently produce NaN and drop every RAG result.
    const a = [1, 0, 0];
    const b = [1, 0, 0, 0, 0];
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(Number.isNaN(cosineSimilarity(a, b))).toBe(false);
  });
});
