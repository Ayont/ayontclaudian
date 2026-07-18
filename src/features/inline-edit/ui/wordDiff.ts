/**
 * Word-level (intra-line) diff refinement for the inline-edit preview.
 *
 * The base diff is line-level, so a one-word edit paints the whole paragraph
 * red/green. This module refines a changed region to mark only the words that
 * actually changed — wrapping them in `<mark>` spans that Obsidian's markdown
 * renderer passes through, so surrounding markdown still formats normally.
 *
 * Pure + framework-free so the tokenizer/diff/highlight logic is unit tested.
 */

export interface WordDiffOp {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

/**
 * Split into word / whitespace / single-punctuation tokens, preserving every
 * character so `tokens.join('') === text`. Fine-grained punctuation tokens keep
 * the alignment tight (e.g. only the changed word inside a sentence is marked).
 */
export function tokenizeWords(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

/** Escape only the HTML-structural characters; leave markdown syntax intact. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mergeAdjacent(ops: WordDiffOp[]): WordDiffOp[] {
  const merged: WordDiffOp[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.text += op.text;
    } else {
      merged.push({ ...op });
    }
  }
  return merged;
}

/** Token-level LCS diff (same shape as the line diff, one level finer). */
export function computeWordDiff(oldText: string, newText: string): WordDiffOp[] {
  const a = tokenizeWords(oldText);
  const b = tokenizeWords(newText);
  const m = a.length, n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: WordDiffOp[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', text: b[j - 1] });
      j--;
    } else {
      ops.push({ type: 'delete', text: a[i - 1] });
      i--;
    }
  }

  return mergeAdjacent(ops.reverse());
}

function markSpan(variant: 'del' | 'ins', text: string): string {
  return `<mark class="claudian-diff-word claudian-diff-word-${variant}">${escapeHtml(text)}</mark>`;
}

/**
 * Build word-highlighted markdown for the "before" and "after" blocks.
 * Returns null (caller falls back to plain line-level rendering) when the text
 * contains backticks — injecting `<mark>` inside code spans/fences would corrupt
 * the code, and word-level highlighting of code is rarely what the user wants.
 */
export function buildWordHighlightedMarkdown(
  oldText: string,
  newText: string,
): { oldMarkdown: string; newMarkdown: string } | null {
  if (oldText.includes('`') || newText.includes('`')) {
    return null;
  }

  const ops = computeWordDiff(oldText, newText);

  const oldMarkdown = ops
    .filter(op => op.type !== 'insert')
    .map(op => (op.type === 'delete' ? markSpan('del', op.text) : escapeHtml(op.text)))
    .join('');

  const newMarkdown = ops
    .filter(op => op.type !== 'delete')
    .map(op => (op.type === 'insert' ? markSpan('ins', op.text) : escapeHtml(op.text)))
    .join('');

  return { oldMarkdown, newMarkdown };
}
