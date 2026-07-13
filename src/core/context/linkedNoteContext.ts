import type { App } from 'obsidian';

const MAX_LINKED_NOTES = 6;
const MAX_NOTE_CHARS = 700;
const MAX_CONTEXT_CHARS = 5_000;

/** Builds a small, deterministic neighborhood around the attached current note. */
export async function buildLinkedNoteContext(app: App, sourcePath: string | null): Promise<string> {
  if (!sourcePath) return '';
  const resolved = app.metadataCache.resolvedLinks ?? {};
  const weights = new Map<string, number>();

  for (const [target, count] of Object.entries(resolved[sourcePath] ?? {})) {
    weights.set(target, (weights.get(target) ?? 0) + Number(count) + 3);
  }
  for (const [source, targets] of Object.entries(resolved)) {
    const backlinkWeight = Number(targets[sourcePath] ?? 0);
    if (backlinkWeight > 0) weights.set(source, (weights.get(source) ?? 0) + backlinkWeight);
  }

  const paths = [...weights.entries()]
    .filter(([path]) => path !== sourcePath && path.toLowerCase().endsWith('.md'))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LINKED_NOTES)
    .map(([path]) => path);
  if (paths.length === 0) return '';

  const entries: string[] = [];
  for (const path of paths) {
    try {
      const content = (await app.vault.adapter.read(path))
        .replace(/^---[\s\S]*?---\s*/m, '')
        .trim()
        .slice(0, MAX_NOTE_CHARS);
      entries.push(`- [[${path}]]\n  ${content || '(leer)'}`);
    } catch {
      // Broken links are intentionally skipped.
    }
  }
  if (entries.length === 0) return '';

  return `<graph_context>\nDirekt verknüpfte Notizen zu [[${sourcePath}]]:\n\n${entries.join('\n\n')}\n</graph_context>`
    .slice(0, MAX_CONTEXT_CHARS);
}
