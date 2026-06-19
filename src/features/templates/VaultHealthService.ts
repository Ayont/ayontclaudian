import type { App } from 'obsidian';

export interface VaultHealthResult {
  command: string;
  summary: string;
  items: VaultHealthItem[];
}

export interface VaultHealthItem {
  path: string;
  description: string;
  severity: 'info' | 'warning' | 'error';
}

/**
 * Vault health analysis commands. Each method scans the vault and returns
 * structured results that the chat or dashboard can display.
 */
export class VaultHealthService {
  constructor(private readonly app: App) {}

  /**
   * /orphan-check — finds notes with no incoming wikilinks (orphaned notes).
   */
  async orphanCheck(): Promise<VaultHealthResult> {
    const files = this.app.vault.getMarkdownFiles();
    const linkedPaths = new Set<string>();

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
          const target = match[1].trim();
          const targetFile = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
          if (targetFile) {
            linkedPaths.add(targetFile.path);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    const orphans = files
      .filter((f) => !linkedPaths.has(f.path))
      .filter((f) => !f.path.startsWith('.'))
      .map((f) => ({
        path: f.path,
        description: 'No incoming links — this note is not referenced anywhere.',
        severity: 'warning' as const,
      }));

    return {
      command: 'orphan-check',
      summary: `${orphans.length} orphaned note(s) found (no incoming links).`,
      items: orphans.slice(0, 50),
    };
  }

  /**
   * /tag-dedupe — finds duplicate or near-duplicate tags (case variations,
   * singular/plural pairs).
   */
  async tagDedupe(): Promise<VaultHealthResult> {
    const files = this.app.vault.getMarkdownFiles();
    const tagCounts = new Map<string, number>();
    const tagVariations = new Map<string, string[]>();

    for (const file of files) {
      try {
        const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.tags) {
        for (const tag of cache.tags) {
          const normalized = tag.tag.replace(/^#/, '').toLowerCase().replace(/[-_]/g, '-');
          tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
          const variants = tagVariations.get(normalized) ?? [];
          if (!variants.includes(tag.tag)) variants.push(tag.tag);
          tagVariations.set(normalized, variants);
        }
      }
      } catch {
        // Skip
      }
    }

    const items: VaultHealthItem[] = [];
    for (const [normalized, variants] of tagVariations) {
      if (variants.length > 1) {
        items.push({
          path: `#${normalized}`,
          description: `Tag variations: ${variants.join(', ')} — consider consolidating.`,
          severity: 'info',
        });
      }
    }

    return {
      command: 'tag-dedupe',
      summary: `${items.length} tag group(s) with variations found.`,
      items: items.slice(0, 50),
    };
  }

  /**
   * /link-suggest — finds notes that could be linked but aren't, based on
   * title mentions in other notes' content.
   */
  async linkSuggest(): Promise<VaultHealthResult> {
    const files = this.app.vault.getMarkdownFiles();
    const items: VaultHealthItem[] = [];

    // Build a map of note basenames to file paths
    const nameToPath = new Map<string, string>();
    for (const file of files) {
      nameToPath.set(file.basename.toLowerCase(), file.path);
    }

    for (const file of files) {
      if (file.path.startsWith('.')) continue;
      try {
        const content = await this.app.vault.read(file);
        const existingLinks = new Set<string>();
        const cache = this.app.metadataCache.getFileCache(file);
        if (cache?.links) {
          for (const link of cache.links) {
            existingLinks.add(link.link.toLowerCase());
          }
        }

        for (const [name, path] of nameToPath) {
          if (path === file.path) continue;
          if (existingLinks.has(name)) continue;
          // Check if the note name appears as a word in the content
          const wordBoundary = new RegExp(`\\b${this.escapeRegex(name)}\\b`, 'i');
          if (wordBoundary.test(content) && name.length > 3) {
            items.push({
              path: file.path,
              description: `Mentions "${name}" ([[${path}]]) but doesn't link to it.`,
              severity: 'info',
            });
            break; // One suggestion per file to keep results manageable
          }
        }
      } catch {
        // Skip
      }
    }

    return {
      command: 'link-suggest',
      summary: `${items.length} potential link(s) found across the vault.`,
      items: items.slice(0, 50),
    };
  }

  /**
   * /dedupe — finds notes with very similar content (potential duplicates).
   * Uses a simple Jaccard similarity on word sets.
   */
  async dedupe(): Promise<VaultHealthResult> {
    const files = this.app.vault.getMarkdownFiles().filter((f) => !f.path.startsWith('.'));
    const wordSets = new Map<string, Set<string>>();
    const items: VaultHealthItem[] = [];

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const words = new Set(
          content
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 3),
        );
        wordSets.set(file.path, words);
      } catch {
        // Skip
      }
    }

    const checked = new Set<string>();
    const filePaths = files.map((f) => f.path);
    for (let i = 0; i < filePaths.length; i++) {
      for (let j = i + 1; j < filePaths.length; j++) {
        const pairKey = `${filePaths[i]}||${filePaths[j]}`;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const setA = wordSets.get(filePaths[i]);
        const setB = wordSets.get(filePaths[j]);
        if (!setA || !setB) continue;

        const similarity = this.jaccardSimilarity(setA, setB);
        if (similarity > 0.6) {
          items.push({
            path: filePaths[i],
            description: `Similar to [[${filePaths[j]}]] (${(similarity * 100).toFixed(0)}% overlap).`,
            severity: 'warning',
          });
        }
      }
    }

    return {
      command: 'dedupe',
      summary: `${items.length} potential duplicate pair(s) found.`,
      items: items.slice(0, 30),
    };
  }

  private jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    let intersection = 0;
    for (const word of a) {
      if (b.has(word)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
