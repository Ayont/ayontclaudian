import {
  buildWordHighlightedMarkdown,
  computeWordDiff,
  tokenizeWords,
} from '@/features/inline-edit/ui/wordDiff';

describe('tokenizeWords', () => {
  it('preserves every character (join reconstructs the input)', () => {
    const text = 'Hello,  world! Ölpreis-Strategie.';
    expect(tokenizeWords(text).join('')).toBe(text);
  });

  it('splits words, whitespace runs and single punctuation', () => {
    expect(tokenizeWords('a b, c')).toEqual(['a', ' ', 'b', ',', ' ', 'c']);
  });

  it('returns [] for empty input', () => {
    expect(tokenizeWords('')).toEqual([]);
  });
});

describe('computeWordDiff', () => {
  it('marks only the changed word in a sentence', () => {
    const ops = computeWordDiff('the quick brown fox', 'the quick red fox');
    expect(ops.filter(o => o.type === 'delete').map(o => o.text)).toEqual(['brown']);
    expect(ops.filter(o => o.type === 'insert').map(o => o.text)).toEqual(['red']);
    // Everything else stays equal.
    const equalText = ops.filter(o => o.type === 'equal').map(o => o.text).join('');
    expect(equalText).toBe('the quick  fox');
  });

  it('is all-equal when texts match', () => {
    const ops = computeWordDiff('same text', 'same text');
    expect(ops.every(o => o.type === 'equal')).toBe(true);
  });

  it('reconstructs old and new from the ops', () => {
    const oldText = 'alpha beta gamma';
    const newText = 'alpha delta gamma epsilon';
    const ops = computeWordDiff(oldText, newText);
    expect(ops.filter(o => o.type !== 'insert').map(o => o.text).join('')).toBe(oldText);
    expect(ops.filter(o => o.type !== 'delete').map(o => o.text).join('')).toBe(newText);
  });
});

describe('buildWordHighlightedMarkdown', () => {
  it('wraps only changed words in mark spans', () => {
    const result = buildWordHighlightedMarkdown('the quick brown fox', 'the quick red fox');
    expect(result).not.toBeNull();
    expect(result!.oldMarkdown).toBe('the quick <mark class="claudian-diff-word claudian-diff-word-del">brown</mark> fox');
    expect(result!.newMarkdown).toBe('the quick <mark class="claudian-diff-word claudian-diff-word-ins">red</mark> fox');
  });

  it('escapes HTML-structural characters but leaves markdown syntax intact', () => {
    const result = buildWordHighlightedMarkdown('a < b and **bold**', 'a > b and **bold**');
    expect(result).not.toBeNull();
    // < and > escaped; ** preserved so markdown still renders bold.
    expect(result!.oldMarkdown).toContain('&lt;');
    expect(result!.newMarkdown).toContain('&gt;');
    expect(result!.newMarkdown).toContain('**bold**');
  });

  it('bails out (returns null) when the text contains backticks (code)', () => {
    expect(buildWordHighlightedMarkdown('run `npm test`', 'run `npm build`')).toBeNull();
  });
});
