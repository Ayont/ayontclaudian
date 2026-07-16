interface FenceState {
  marker: '`' | '~';
  length: number;
}

function getFenceRun(line: string): string | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  return match?.[1] ?? null;
}

function isClosingFence(line: string, fence: FenceState): boolean {
  const run = getFenceRun(line);
  return !!run && run[0] === fence.marker && run.length >= fence.length;
}

function isHtmlTagStart(line: string, index: number): boolean {
  const next = line[index + 1];
  return !!next && /[A-Za-z/!?]/.test(next);
}

function readBacktickRun(line: string, index: number): number {
  let length = 0;
  while (line[index + length] === '`') {
    length += 1;
  }
  return length;
}

/**
 * Walks one line with the inline-code / HTML-tag state machine the escaper
 * uses and reports each dollar that would be escaped, so the detection pass
 * shares the exact same rules without building the escaped string. Returning
 * false from `onDollar` stops the walk at the first hit.
 */
function forEachEscapableDollar(line: string, onDollar: (index: number) => boolean): void {
  let inlineCodeRunLength = 0;
  let inHtmlTag = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '`') {
      const runLength = readBacktickRun(line, index);
      index += runLength - 1;
      if (inlineCodeRunLength === 0) {
        inlineCodeRunLength = runLength;
      } else if (runLength === inlineCodeRunLength) {
        inlineCodeRunLength = 0;
      }
      continue;
    }

    if (inlineCodeRunLength > 0) {
      continue;
    }

    if (inHtmlTag) {
      if (char === '>') {
        inHtmlTag = false;
      }
      continue;
    }

    if (char === '<' && isHtmlTagStart(line, index)) {
      inHtmlTag = true;
      continue;
    }

    if (char === '\\' && line[index + 1] === '$') {
      index += 1;
      continue;
    }

    if (char === '$' && !onDollar(index)) {
      return;
    }
  }
}

function escapeMathDelimitersInLine(line: string): string {
  if (!line.includes('$')) {
    return line;
  }

  let escaped = '';
  let copiedUpTo = 0;
  forEachEscapableDollar(line, (index) => {
    escaped += line.slice(copiedUpTo, index) + '\\$';
    copiedUpTo = index + 1;
    return true;
  });

  return copiedUpTo === 0 ? line : escaped + line.slice(copiedUpTo);
}

function lineHasEscapableDollar(line: string): boolean {
  if (!line.includes('$')) {
    return false;
  }

  let found = false;
  forEachEscapableDollar(line, () => {
    found = true;
    // The first escapable dollar already decides the line.
    return false;
  });
  return found;
}

/**
 * Walks the document line by line, tracking fenced code blocks, and hands each
 * line to `visit` along with whether it sits inside a fence. Returning false
 * stops the walk early so detection can bail on the first math delimiter.
 */
function forEachLineWithFenceState(
  markdown: string,
  visit: (line: string, inFence: boolean) => boolean
): void {
  let fence: FenceState | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newlineIndex = markdown.indexOf('\n', lineStart);
    const lineEnd = newlineIndex === -1 ? markdown.length : newlineIndex + 1;
    const line = markdown.slice(lineStart, lineEnd);
    const lineWithoutNewline = line.endsWith('\n') ? line.slice(0, -1) : line;

    if (fence) {
      if (!visit(line, true)) {
        return;
      }
      if (isClosingFence(lineWithoutNewline, fence)) {
        fence = null;
      }
    } else {
      const fenceRun = getFenceRun(lineWithoutNewline);
      if (fenceRun) {
        // Fence markers pass through verbatim — their dollars belong to the fence.
        if (!visit(line, true)) {
          return;
        }
        fence = {
          marker: fenceRun[0] as '`' | '~',
          length: fenceRun.length,
        };
      } else if (!visit(line, false)) {
        return;
      }
    }

    lineStart = lineEnd;
  }
}

/**
 * Escapes dollar math delimiters outside code spans and fenced code blocks.
 * Used only for transient streaming renders so MarkdownRenderer does not hand
 * incomplete math to Obsidian's math renderer on every frame.
 */
export function escapeMathDelimitersForStreaming(markdown: string): string {
  if (!markdown.includes('$')) {
    return markdown;
  }

  let result = '';
  forEachLineWithFenceState(markdown, (line, inFence) => {
    result += inFence ? line : escapeMathDelimitersInLine(line);
    return true;
  });
  return result;
}

/**
 * Cheap early-exit scan answering whether escaping would change the input.
 * Runs on every streaming frame, so it must not build the full escaped string
 * just to compare it against the original.
 */
export function hasStreamingMathDelimiters(markdown: string): boolean {
  if (!markdown.includes('$')) {
    return false;
  }

  let found = false;
  forEachLineWithFenceState(markdown, (line, inFence) => {
    if (!inFence && lineHasEscapableDollar(line)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}
