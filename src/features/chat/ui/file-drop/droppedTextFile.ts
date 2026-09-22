/**
 * Helpers for handling text-like files dropped onto the chat input.
 *
 * Small text files are inlined into the prompt as a fenced code block, so the
 * message stays a plain string the user can edit around. Anything too large to
 * read in a chat bubble is staged as an attachment instead (tables always are,
 * see tableProfile). Pure functions only; no DOM, no I/O.
 */

/**
 * Inline limits for a dropped text file. An inlined file is not sent once: it
 * lives in the textarea, the user bubble, the prompt, the provider transcript,
 * the session metadata and every replayed history turn. Past a few hundred
 * lines that costs far more than it helps — the reported 3CX call logs made
 * one message 1.3 MB — while the agent can open a staged file with its own
 * tools. 400 lines is roughly the longest file still readable in a bubble;
 * 64 KB (~16k tokens) catches files with few but very long lines.
 */
export const MAX_INLINE_TEXT_BYTES = 64 * 1024;
export const MAX_INLINE_TEXT_LINES = 400;

/** Extensions we treat as inline-able text. */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'rst', 'org', 'tex',
  'json', 'jsonc', 'json5', 'ndjson',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'cts', 'mts',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'clj', 'groovy',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx', 'cs', 'm', 'mm', 'swift',
  'php', 'pl', 'pm', 'lua', 'r', 'dart', 'ex', 'exs', 'erl', 'elm', 'hs', 'ml',
  'css', 'scss', 'sass', 'less', 'styl',
  'html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'astro', 'jsx',
  'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 'editorconfig',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'prisma',
  'csv', 'tsv', 'log', 'diff', 'patch',
  'dockerfile', 'gradle', 'makefile', 'cmake', 'gitignore', 'gitattributes',
]);

/** Extensionless / dotfile basenames we still treat as text. */
const TEXT_FILENAMES = new Set([
  'makefile', 'dockerfile', 'license', 'readme', 'changelog', 'authors',
  'contributing', 'codeowners', '.gitignore', '.gitattributes', '.editorconfig',
  '.env', '.npmrc', '.prettierrc', '.eslintrc', '.babelrc',
]);

/** Basename, lowercased, OS-path-separator agnostic. */
function baseName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name).toLowerCase();
}

/**
 * Extension (without dot). Dotfiles like `.gitignore` → `gitignore`.
 * Extensionless names (e.g. `Makefile`) → `''`.
 */
export function getFileExtension(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return '';
  if (dot === 0) return base.slice(1);
  return base.slice(dot + 1);
}

/** True when a dropped file should be inlined as text rather than rejected. */
export function isTextLikeFile(name: string, mimeType = ''): boolean {
  const mt = (mimeType || '').toLowerCase();
  if (mt.startsWith('text/')) return true;
  if (mt === 'application/json' || mt === 'application/xml' || mt === 'application/x-yaml') {
    return true;
  }
  const base = baseName(name);
  if (TEXT_FILENAMES.has(base)) return true;
  const ext = getFileExtension(name);
  return ext !== '' && TEXT_EXTENSIONS.has(ext);
}

/** Fenced-code language hint derived from the filename (best-effort). */
export function languageForFile(name: string): string {
  const ext = getFileExtension(name);
  return ext;
}

/**
 * Builds a fenced code block for an inlined file, choosing a backtick fence
 * longer than any backtick run inside the content so embedded fences (common in
 * markdown) never break out.
 */
export function formatDroppedFileBlock(name: string, content: string): string {
  const fileName = name.split(/[\\/]/).pop() ?? name;
  const normalized = content.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const longestRun = (normalized.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const lang = languageForFile(name);
  return `\n\n${fence}${lang} ${fileName}\n${normalized}\n${fence}\n`;
}

/** Number of lines, ignoring one trailing line break. */
export function countTextLines(text: string): number {
  if (!text) return 0;
  const breaks = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return /(?:\r\n|\r|\n)$/.test(text) ? breaks : breaks + 1;
}

/**
 * True when a dropped text file should become an attachment instead of being
 * inlined. `text` is optional so oversized files are decided before reading.
 */
export function exceedsInlineTextLimit(sizeBytes: number, text?: string): boolean {
  if (sizeBytes > MAX_INLINE_TEXT_BYTES) return true;
  return text !== undefined && countTextLines(text) > MAX_INLINE_TEXT_LINES;
}
