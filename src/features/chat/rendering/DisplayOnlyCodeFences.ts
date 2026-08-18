export interface DisplayOnlyCodeFence {
  placeholderLanguage: string;
  originalLanguage: string;
}

export interface PreparedDisplayOnlyCodeFences {
  markdown: string;
  fences: DisplayOnlyCodeFence[];
}

const PLACEHOLDER_LANGUAGE_PREFIX = 'claudian-display-only-fence-';
const OPENING_FENCE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Rewrites fenced-code language tags so Obsidian cannot dispatch a registered
 * code-block processor (`dataview`, `templater`, …) while rendering chat.
 * Ported from YishenTu/claudian #1041; implemented without their markdownSegments
 * helper so the rest of that module is not pulled in.
 */
export function prepareDisplayOnlyCodeFences(markdown: string): PreparedDisplayOnlyCodeFences {
  const fences: DisplayOnlyCodeFence[] = [];
  const lines = markdown.split('\n');
  let inFence: { marker: '`' | '~'; length: number } | null = null;

  const rewritten = lines.map((rawLine) => {
    const hadCr = rawLine.endsWith('\r');
    const line = hadCr ? rawLine.slice(0, -1) : rawLine;
    const match = line.match(OPENING_FENCE);
    if (!match) {
      return rawLine;
    }

    const indent = match[1];
    const run = match[2];
    const info = match[3];
    const marker = run[0] as '`' | '~';
    const length = run.length;

    if (!inFence) {
      inFence = { marker, length };
      const languageMatch = info.match(/^([\t ]*)(\S+)(.*)$/);
      if (!languageMatch) {
        return rawLine;
      }
      const placeholderLanguage = `${PLACEHOLDER_LANGUAGE_PREFIX}${fences.length}`;
      fences.push({ placeholderLanguage, originalLanguage: languageMatch[2] });
      const next = `${indent}${run}${languageMatch[1]}${placeholderLanguage}${languageMatch[3]}`;
      return hadCr ? `${next}\r` : next;
    }

    if (marker === inFence.marker && length >= inFence.length && info.trim() === '') {
      inFence = null;
    }
    return rawLine;
  });

  return { markdown: rewritten.join('\n'), fences };
}

/** Restores the original language class after Markdown post-processors finish. */
export async function restoreDisplayOnlyCodeFences(
  container: HTMLElement,
  fences: readonly DisplayOnlyCodeFence[],
): Promise<void> {
  for (const fence of fences) {
    const code = container.querySelector(`.language-${fence.placeholderLanguage}`);
    if (!code) {
      continue;
    }
    code.classList.remove(`language-${fence.placeholderLanguage}`);
    code.classList.add(`language-${fence.originalLanguage}`);
  }
}
