import { extractContextSources, sourceChipLabel } from '@/core/prompt/contextSources';

const SAMPLE = `<vault_context>
Relevant vault knowledge:

- From [[02-Projekte/Veylor.md]] (score 61%):
  Some snippet text about Veylor.

- From [[01-Arbeit/HUNARI.md]] (score 40%):
  HUNARI snippet.
</vault_context>`;

describe('extractContextSources', () => {
  it('extracts paths and scores from an injected vault_context block', () => {
    const sources = extractContextSources(SAMPLE);
    expect(sources).toEqual([
      { path: '02-Projekte/Veylor.md', score: 61 },
      { path: '01-Arbeit/HUNARI.md', score: 40 },
    ]);
  });

  it('returns [] for empty / missing input', () => {
    expect(extractContextSources('')).toEqual([]);
    expect(extractContextSources(undefined)).toEqual([]);
    expect(extractContextSources(null)).toEqual([]);
  });

  it('deduplicates by path, keeping the highest score', () => {
    const text = '[[a.md]] (score 30%) ... [[a.md]] (score 55%) ... [[b.md]] (score 10%)';
    expect(extractContextSources(text)).toEqual([
      { path: 'a.md', score: 55 },
      { path: 'b.md', score: 10 },
    ]);
  });

  it('handles wikilinks without a score', () => {
    expect(extractContextSources('see [[notes/x.md]] for details')).toEqual([
      { path: 'notes/x.md', score: null },
    ]);
  });

  it('preserves first-seen order', () => {
    const text = '[[z.md]] (score 5%) [[a.md]] (score 9%)';
    expect(extractContextSources(text).map(s => s.path)).toEqual(['z.md', 'a.md']);
  });
});

describe('sourceChipLabel', () => {
  it('uses the basename without the .md extension', () => {
    expect(sourceChipLabel('02-Projekte/Veylor.md')).toBe('Veylor');
    expect(sourceChipLabel('note.md')).toBe('note');
    expect(sourceChipLabel('folder/sub/Deep Note.md')).toBe('Deep Note');
  });
});
