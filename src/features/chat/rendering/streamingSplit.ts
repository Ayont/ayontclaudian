/**
 * Finds a point in streaming Markdown before which nothing can still change.
 *
 * Streaming used to re-render the *entire* accumulated answer on every frame, so
 * the cost of a frame grew with the answer while the number of frames grew too —
 * quadratic work, and the reason a long answer makes the whole UI feel heavy.
 * Splitting the text lets the renderer commit the settled part once and re-render
 * only the live edge.
 *
 * The rule is deliberately conservative, because a wrong cut changes how Markdown
 * parses. A boundary is only accepted when it is a blank line that is
 *
 * - not inside an open code fence, and
 * - not directly after a list item, table row, or blockquote line — all of which
 *   can be continued by what arrives next (a loose list is still one list).
 *
 * Anything this misses is merely a missed optimization. Correctness does not rest
 * on the split being maximal: the stream's final pass re-renders the full answer
 * in one piece, so the committed DOM is always replaced by a canonical render.
 */

export interface StableSplitOptions {
  /** Below this much settled text, splitting is not worth the bookkeeping. */
  minStable: number;
  /** Characters kept live so the trailing block can still finish forming. */
  minTail: number;
}

const FENCE_PATTERN = /^\s{0,3}(?:```|~~~)/;
/** Lines whose block can be continued after a blank line. */
const CONTINUABLE_PATTERN = /^\s{0,3}(?:[-*+]\s|\d+[.)]\s|>|\|)/;

export function findStableMarkdownSplit(
  markdown: string,
  options: StableSplitOptions,
): number {
  const { minStable, minTail } = options;
  if (markdown.length < minStable + minTail) {
    return 0;
  }

  const lines = markdown.split('\n');
  let insideFence = false;
  let offset = 0;
  let lastSafeSplit = 0;
  let previousContentLine = '';

  for (const line of lines) {
    const lineEnd = offset + line.length + 1;

    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
      previousContentLine = line;
      offset = lineEnd;
      continue;
    }

    const isBlank = line.trim() === '';
    if (isBlank && !insideFence && previousContentLine !== '') {
      // `lineEnd` is the offset just past this blank line's newline, i.e. the
      // start of the next block.
      if (!CONTINUABLE_PATTERN.test(previousContentLine)) {
        const tailLength = markdown.length - lineEnd;
        if (lineEnd >= minStable && tailLength >= minTail) {
          lastSafeSplit = lineEnd;
        }
      }
    }

    if (!isBlank) {
      previousContentLine = line;
    }
    offset = lineEnd;
  }

  return lastSafeSplit;
}
