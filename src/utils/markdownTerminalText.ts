import { forEachLineWithFenceState } from './markdownMath';

/**
 * Keeping pasted terminal output readable.
 *
 * Console and PowerShell transcripts are the most common thing in this product,
 * and two of their most ordinary decorations are also Markdown syntax:
 *
 *   `=== Aenderung wird angewendet ===`
 *     Obsidian's highlight delimiter is exactly `==`, so the parser consumed two
 *     equals signs on each side and highlighted the rest — the banner came out
 *     yellow with a stray `=` still hanging off both ends.
 *
 *   `-------- ----------- ------`
 *     A PowerShell table rule. Markdown saw a thematic break and drew a
 *     horizontal line across the message, taking the column layout with it.
 *
 * Both are distinguishable from the real thing without guessing: highlight uses
 * exactly two equals signs, never three or more, and a Markdown rule is one
 * unbroken run of dashes, never several separated by spaces.
 *
 * Sibling of `neutralizeNonMathDollars` in ./markdownMath — same idea, same
 * contract: escape only what is unambiguous, leave genuine Markdown alone.
 */

/** Three or more equals signs — never a highlight delimiter. */
const BANNER_RUN = /={3,}/g;

/** Two or more dash groups separated by spaces — a table rule, not a break. */
const TABLE_RULE = /^(\s*)(-{2,}(?:\s+-{2,})+\s*)$/;

function readBacktickRun(line: string, index: number): number {
  let length = 0;
  while (line[index + length] === '`') {
    length += 1;
  }
  return length;
}

/**
 * Applies `transform` to every stretch of the line that is NOT inside an inline
 * code span, so `` `=== Titel ===` `` keeps its equals signs verbatim.
 */
function transformOutsideInlineCode(line: string, transform: (text: string) => string): string {
  if (!line.includes('`')) {
    return transform(line);
  }

  let result = '';
  let segmentStart = 0;
  let openRunLength = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '`') continue;

    const runLength = readBacktickRun(line, index);
    if (openRunLength === 0) {
      result += transform(line.slice(segmentStart, index));
      segmentStart = index;
      openRunLength = runLength;
    } else if (runLength === openRunLength) {
      // The span including both markers passes through untouched.
      result += line.slice(segmentStart, index + runLength);
      segmentStart = index + runLength;
      openRunLength = 0;
    }
    index += runLength - 1;
  }

  const tail = line.slice(segmentStart);
  return openRunLength === 0 ? result + transform(tail) : result + tail;
}

function neutralizeLine(line: string): string {
  const tableRule = TABLE_RULE.exec(line.replace(/\r?\n$/, ''));
  if (tableRule) {
    // Escaping the first dash is enough: the line is then neither a thematic
    // break nor a list item, and renders exactly as it was typed.
    const newline = line.slice(tableRule[0].length);
    return `${tableRule[1]}\\${tableRule[2]}${newline}`;
  }

  if (!line.includes('==')) {
    return line;
  }

  return transformOutsideInlineCode(line, (text) =>
    text.replace(BANNER_RUN, (run) => '\\='.repeat(run.length)),
  );
}

/**
 * Escapes the terminal decorations that Markdown would otherwise swallow.
 * Fenced blocks and inline code spans pass through untouched, and genuine
 * `==highlight==` and `---` rules keep working.
 */
export function neutralizeTerminalMarkdown(markdown: string): string {
  if (!markdown.includes('==') && !markdown.includes('--')) {
    return markdown;
  }

  let result = '';
  forEachLineWithFenceState(markdown, (line, inFence) => {
    result += inFence ? line : neutralizeLine(line);
    return true;
  });
  return result;
}
