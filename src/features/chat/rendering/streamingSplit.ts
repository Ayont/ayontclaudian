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

/**
 * Captures the fence marker so an open fence is only closed by its OWN marker.
 * A single boolean would let a `~~~` line inside a ``` block close it, and the
 * splitter would then cut in the middle of the code — showing Markdown syntax
 * inside a fence is routine here, so this is not hypothetical.
 */
const FENCE_PATTERN = /^\s{0,3}(```+|~~~+)/;
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
  /** Marker char of the fence currently open ('`' or '~'), or null outside one. */
  let openFenceChar: string | null = null;
  let offset = 0;
  let lastSafeSplit = 0;
  let previousContentLine = '';

  for (const line of lines) {
    const lineEnd = offset + line.length + 1;
    const fence = FENCE_PATTERN.exec(line);

    if (fence) {
      const marker = fence[1][0];
      if (openFenceChar === null) {
        openFenceChar = marker;
      } else if (openFenceChar === marker) {
        openFenceChar = null;
      }
      previousContentLine = line;
      offset = lineEnd;
      continue;
    }

    const isBlank = line.trim() === '';
    if (isBlank && openFenceChar === null && previousContentLine !== '') {
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
