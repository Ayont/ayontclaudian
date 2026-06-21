export interface EmbeddingService {
  embed(texts: string[]): Promise<number[][]>;
  getDimension(): number;
  isAvailable(): Promise<boolean>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  // Vectors from different embedding models have different dimensions. Comparing
  // them would read past the end of the shorter vector (undefined → NaN) and
  // silently drop every result. Refuse mismatched dimensions instead.
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function normalizeVector(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return v;
  return v.map(x => x / norm);
}
