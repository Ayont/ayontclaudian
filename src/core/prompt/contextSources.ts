/**
 * Parse the vault-context block that the RAG layer injects for a turn into a
 * clean list of source notes, so the answer can surface clickable citations
 * ("which of my notes grounded this answer?") without the reader expanding the
 * full context card.
 *
 * The injected format (see InputController) is one entry per line:
 *   `- From [[path/to/note.md]] (score 42%):`
 */

export interface ContextSource {
  /** Vault-relative path of the source note. */
  path: string;
  /** Retrieval similarity score in percent (0–100), or null if absent. */
  score: number | null;
}

const SOURCE_PATTERN = /\[\[([^[\]]+?)\]\](?:\s*\(score\s*(\d+)\s*%\))?/g;

/**
 * Extract the deduplicated source notes from an injected `<vault_context>`
 * string, preserving first-seen order and keeping the highest score per note.
 */
export function extractContextSources(vaultContext: string | undefined | null): ContextSource[] {
  if (!vaultContext) return [];

  const byPath = new Map<string, ContextSource>();
  for (const match of vaultContext.matchAll(SOURCE_PATTERN)) {
    const path = match[1]?.trim();
    if (!path) continue;
    const score = match[2] !== undefined ? Number(match[2]) : null;

    const existing = byPath.get(path);
    if (!existing) {
      byPath.set(path, { path, score });
    } else if (score !== null && (existing.score === null || score > existing.score)) {
      existing.score = score;
    }
  }

  return Array.from(byPath.values());
}

/** Display label for a source chip: the note's basename without extension. */
export function sourceChipLabel(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.md$/i, '');
}
/**
 * Format injected graph context for display: condense multi-note dumps into a
 * compact card showing the hub note and linked notes without the raw snippets.
 *
 * Input example:
 *   Direkt verknüpfte Notizen zu [[Home.md]]:
 *
 *   - [[Claudian/Conversations/VLA.md]]
 *     Wir machen jetzt eine dokumentations liste
 *     <recommended_plugins>
 *
 * Output:
 *   Direkt verknüpft mit [[Home.md]]
 *
 *   - [[Claudian/Conversations/VLA.md]]
 */
export function formatGraphContextForDisplay(raw: string): string {
  if (!raw) return raw;

  const lines = raw.split('\n');

  // Rewrite the heading: "zu" → "mit" (shorter, more natural)
  const headingRx = /^Direkt verknüpfte Notizen zu (\[\[.+?\]\]):/;
  const heading = lines[0]?.replace(headingRx, 'Direkt verknüpft mit $1') ?? lines[0];

  // Filter to heading + linked-note lines (drop raw note dumps)
  const filtered = [heading];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Keep empty lines and lines starting with "- [[" (wikilink entries)
    if (line === '' || /^- \[\[.+?\]\]/.test(line)) {
      filtered.push(line);
    }
  }

  return filtered.join('\n');
}
