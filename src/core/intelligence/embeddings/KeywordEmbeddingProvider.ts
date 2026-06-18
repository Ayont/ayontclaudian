import type { EmbeddingService } from './EmbeddingService';
import { normalizeVector } from './EmbeddingService';

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'wie', 'was', 'und', 'oder', 'der', 'die', 'das', 'ein', 'eine',
  'bitte', 'please', 'about', 'from', 'into', 'todo', 'kurz', 'mal', 'so', 'ist', 'sind', 'auf', 'für', 'von', 'den',
]);

export class KeywordEmbeddingProvider implements EmbeddingService {
  private vocabulary = new Map<string, number>();

  constructor(private readonly dimension = 256) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getDimension(): number {
    return this.dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.embedSingle(text));
  }

  private embedSingle(text: string): number[] {
    const tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .filter(token => token.length >= 3 && !STOPWORDS.has(token));

    const vector = new Array(this.dimension).fill(0);
    for (const token of tokens) {
      let index = this.vocabulary.get(token);
      if (index === undefined) {
        index = this.vocabulary.size % this.dimension;
        this.vocabulary.set(token, index);
      }
      vector[index] += 1;
    }
    return normalizeVector(vector);
  }
}
