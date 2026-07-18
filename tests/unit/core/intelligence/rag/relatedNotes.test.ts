import {
  buildRelatedQueryText,
  makeSnippet,
  rankRelatedNotes,
} from '@/core/intelligence/rag/relatedNotes';
import type { RAGChunk } from '@/core/intelligence/rag/VaultRAGService';

function chunk(path: string, score: number, text = 'some text'): RAGChunk {
  return { id: `${path}-${score}`, path, score, text };
}

describe('rankRelatedNotes', () => {
  it('excludes the active note itself', () => {
    const chunks = [chunk('active.md', 0.99), chunk('other.md', 0.8)];
    const result = rankRelatedNotes(chunks, 'active.md', 8);
    expect(result.map(r => r.path)).toEqual(['other.md']);
  });

  it('collapses multiple chunks of one note into the best score', () => {
    const chunks = [
      chunk('a.md', 0.4, 'weak match'),
      chunk('a.md', 0.9, 'strong match'),
      chunk('a.md', 0.6, 'medium match'),
    ];
    const result = rankRelatedNotes(chunks, 'active.md', 8);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0.9);
    expect(result[0].snippet).toBe('strong match');
  });

  it('sorts notes by score descending', () => {
    const chunks = [chunk('low.md', 0.2), chunk('high.md', 0.95), chunk('mid.md', 0.5)];
    const result = rankRelatedNotes(chunks, 'active.md', 8);
    expect(result.map(r => r.path)).toEqual(['high.md', 'mid.md', 'low.md']);
  });

  it('caps the result count at the limit', () => {
    const chunks = Array.from({ length: 20 }, (_, i) => chunk(`n${i}.md`, i / 20));
    const result = rankRelatedNotes(chunks, 'active.md', 5);
    expect(result).toHaveLength(5);
  });

  it('skips unknown/empty paths', () => {
    const chunks = [chunk('unknown', 0.9), chunk('', 0.8), chunk('real.md', 0.7)];
    const result = rankRelatedNotes(chunks, 'active.md', 8);
    expect(result.map(r => r.path)).toEqual(['real.md']);
  });

  it('returns an empty list when nothing but the active note matches', () => {
    const chunks = [chunk('active.md', 0.99), chunk('active.md', 0.5)];
    expect(rankRelatedNotes(chunks, 'active.md', 8)).toEqual([]);
  });
});

describe('makeSnippet', () => {
  it('collapses whitespace and trims', () => {
    expect(makeSnippet('  hello   \n  world  ')).toBe('hello world');
  });

  it('clips long text with an ellipsis', () => {
    const snippet = makeSnippet('x'.repeat(200), 10);
    expect(snippet).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('buildRelatedQueryText', () => {
  it('returns trimmed content unchanged when short', () => {
    expect(buildRelatedQueryText('  short note  ')).toBe('short note');
  });

  it('caps very long content', () => {
    const text = 'a'.repeat(5000);
    expect(buildRelatedQueryText(text, 4000)).toHaveLength(4000);
  });
});
