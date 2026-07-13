import { normalizePath,type Vault } from 'obsidian';

/**
 * Prompt snippets — saved reusable prompts stored as `.md` files in the vault
 * under `.claudian/snippets/`. Uses `vault.adapter` (dot-folder-safe) to
 * read/write/list, following the same pattern as the memory system.
 */

export interface Snippet {
  name: string;
  body: string;
  tags: string[];
  createdAt: number;
}

export const DEFAULT_SNIPPET_FOLDER = '.claudian/snippets';

export async function listSnippets(
  vault: Vault,
  folder: string = DEFAULT_SNIPPET_FOLDER,
): Promise<Snippet[]> {
  const adapter = vault.adapter;
  if (!(await adapter.exists(normalizePath(folder)))) return [];

  const entries = await adapter.list(normalizePath(folder));
  const files = entries.files.filter((f) => f.endsWith('.md'));
  const snippets: Snippet[] = [];

  for (const file of files) {
    try {
      const raw = await adapter.read(file);
      snippets.push(parseSnippet(raw, file));
    } catch {
      // skip corrupt files
    }
  }

  return snippets.sort((a, b) => b.createdAt - a.createdAt);
}

export function parseSnippet(raw: string, _filePath: string): Snippet {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter — use filename as name
    const name = _filePath.split('/').pop()?.replace(/\.md$/, '') ?? 'snippet';
    return { name, body: raw.trim(), tags: [], createdAt: 0 };
  }

  const fm = fmMatch[1];
  const body = fmMatch[2].trim();
  const name = (fm.match(/^name:\s*(.+)$/m)?.[1] ?? 'snippet').trim().replace(/^["']|["']$/g, '');
  const tagsLine = fm.match(/^tags:\s*(.+)$/m)?.[1] ?? '';
  const tags = tagsLine
    .replace(/[\[\]]/g, '')
    .split(',')
    .map((t) => t.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  const createdAtStr = fm.match(/^created:\s*(.+)$/m)?.[1] ?? '0';
  const createdAt = parseInt(createdAtStr, 10) || Date.now();

  return { name, body, tags, createdAt };
}

export async function saveSnippet(
  vault: Vault,
  name: string,
  body: string,
  tags: string[] = [],
  folder: string = DEFAULT_SNIPPET_FOLDER,
): Promise<void> {
  const adapter = vault.adapter;
  await adapter.mkdir(normalizePath(folder));

  const safeName = name.replace(/[^\wäöüßÄÖÜ\s-]/g, '').trim().replace(/\s+/g, '-') || 'snippet';
  const filePath = normalizePath(`${folder}/${safeName}.md`);

  const fm = [
    '---',
    `name: "${name.replace(/"/g, '\\"')}"`,
    `tags: [${tags.join(', ')}]`,
    `created: ${Date.now()}`,
    '---',
    '',
  ].join('\n');

  await adapter.write(filePath, fm + body);
}

export async function deleteSnippet(
  vault: Vault,
  name: string,
  folder: string = DEFAULT_SNIPPET_FOLDER,
): Promise<boolean> {
  const adapter = vault.adapter;
  const safeName = name.replace(/[^\wäöüßÄÖÜ\s-]/g, '').trim().replace(/\s+/g, '-');
  const filePath = normalizePath(`${folder}/${safeName}.md`);
  if (await adapter.exists(filePath)) {
    await adapter.remove(filePath);
    return true;
  }
  return false;
}
