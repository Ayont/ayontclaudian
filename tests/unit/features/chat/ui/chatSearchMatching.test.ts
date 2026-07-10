import {
  findTextMatches,
  MAX_SEARCH_MATCHES,
  wrapIndex,
} from '@/features/chat/ui/chatSearchMatching';

describe('chatSearchMatching', () => {
  describe('findTextMatches', () => {
    it('finds case-insensitive matches across nodes in document order', () => {
      const texts = ['Hello World', 'no hit here… or hello again', 'HELLO'];

      const matches = findTextMatches(texts, 'hello');

      expect(matches).toEqual([
        { nodeIndex: 0, start: 0, end: 5 },
        { nodeIndex: 1, start: 16, end: 21 },
        { nodeIndex: 2, start: 0, end: 5 },
      ]);
    });

    it('finds multiple non-overlapping matches within one node', () => {
      const matches = findTextMatches(['abcabcabc'], 'abc');

      expect(matches).toHaveLength(3);
      expect(matches[1]).toEqual({ nodeIndex: 0, start: 3, end: 6 });
    });

    it('does not return overlapping matches', () => {
      // 'aaaa' with query 'aa' → offsets 0 and 2, NOT 0/1/2.
      const matches = findTextMatches(['aaaa'], 'aa');

      expect(matches).toEqual([
        { nodeIndex: 0, start: 0, end: 2 },
        { nodeIndex: 0, start: 2, end: 4 },
      ]);
    });

    it('returns empty array for empty query', () => {
      expect(findTextMatches(['anything'], '')).toEqual([]);
    });

    it('respects the match cap', () => {
      const texts = Array.from({ length: 100 }, () => 'x x x x x x x x x x');

      const matches = findTextMatches(texts, 'x');

      expect(matches).toHaveLength(MAX_SEARCH_MATCHES);
    });

    it('handles umlauts and unicode case folding', () => {
      const matches = findTextMatches(['Größe und GRÖSSE-ähnlich: größe'], 'größe');

      // 'GRÖSSE' (ß→SS) is a different length — only exact 'größe'/'Größe' match.
      expect(matches).toEqual([
        { nodeIndex: 0, start: 0, end: 5 },
        { nodeIndex: 0, start: 26, end: 31 },
      ]);
    });
  });

  describe('wrapIndex', () => {
    it('wraps forward past the end', () => {
      expect(wrapIndex(5, 5)).toBe(0);
    });

    it('wraps backward below zero', () => {
      expect(wrapIndex(-1, 5)).toBe(4);
    });

    it('keeps in-range indices unchanged', () => {
      expect(wrapIndex(2, 5)).toBe(2);
    });

    it('returns 0 for empty collections', () => {
      expect(wrapIndex(3, 0)).toBe(0);
    });
  });
});
