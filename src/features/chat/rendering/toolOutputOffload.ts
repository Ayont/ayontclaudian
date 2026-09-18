import type { App } from 'obsidian';

/**
 * Keeping huge tool output out of the DOM.
 *
 * A `bash` call that tails a log or lists a spool directory routinely returns
 * thousands of lines. The inline renderer builds one element per line, so
 * expanding such a result mounts tens of thousands of nodes at once: the
 * renderer stalls, the message becomes unscrollable, and every later re-render
 * of that conversation pays for it again.
 *
 * Past the caps below the output is therefore never mounted in full. A readable
 * head stays inline and the complete text is written to a plain `.txt` in the
 * vault — cheap to write, cheap to open, and the natural place to search or
 * grep it afterwards.
 */

/** Most lines ever mounted for one tool result, even when expanded. */
export const TOOL_OUTPUT_INLINE_LINE_CAP = 500;

/** Character ceiling, so a handful of enormous lines cannot slip past the line cap. */
export const TOOL_OUTPUT_INLINE_CHAR_CAP = 120_000;

/** Vault folder holding offloaded tool output. */
export const TOOL_OUTPUT_FOLDER = '.claudian/tool-output';

export interface ToolOutputRenderPlan {
  /** Lines safe to mount, even after the user expands. */
  renderableLines: string[];
  /** True when the full text must go to a file instead of the DOM. */
  offloaded: boolean;
  /** How many lines were withheld from the DOM. */
  droppedLines: number;
}

export function planToolOutputRendering(lines: readonly string[]): ToolOutputRenderPlan {
  const totalChars = lines.reduce((sum, line) => sum + line.length + 1, 0);
  const overLineCap = lines.length > TOOL_OUTPUT_INLINE_LINE_CAP;
  const overCharCap = totalChars > TOOL_OUTPUT_INLINE_CHAR_CAP;

  if (!overLineCap && !overCharCap) {
    return { droppedLines: 0, offloaded: false, renderableLines: [...lines] };
  }

  // The head is kept: the start of a log or a listing is where the answer
  // usually is, and a stable head keeps the block's height predictable.
  const renderableLines = lines.slice(0, TOOL_OUTPUT_INLINE_LINE_CAP);
  return {
    droppedLines: lines.length - renderableLines.length,
    offloaded: true,
    renderableLines,
  };
}

/**
 * A file name that is readable in the file explorer and unique per result.
 * `seed` disambiguates two results produced in the same minute.
 */
export function buildToolOutputFileName(toolName: string, at: Date, seed: string): string {
  const slug = toolName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const iso = at.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16).replace(':', '');
  return `${slug || 'tool-output'}-${day}-${time}-${seed}.txt`;
}

/**
 * Writes the full output next to the vault and returns its path.
 *
 * Best-effort: a failure here must never break the chat, so the caller keeps
 * the inline head either way.
 */
export async function writeToolOutputFile(
  app: App,
  toolName: string,
  content: string,
  at: Date = new Date(),
): Promise<string | null> {
  try {
    const adapter = app.vault.adapter;
    if (!(await adapter.exists(TOOL_OUTPUT_FOLDER))) {
      await adapter.mkdir(TOOL_OUTPUT_FOLDER);
    }
    const seed = Math.random().toString(36).slice(2, 8);
    const filePath = `${TOOL_OUTPUT_FOLDER}/${buildToolOutputFileName(toolName, at, seed)}`;
    await adapter.write(filePath, content);
    return filePath;
  } catch {
    return null;
  }
}
