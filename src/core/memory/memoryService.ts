import { type App, normalizePath, TFile, type Vault } from 'obsidian';

export interface MemoryNote {
  path: string;
  topic: string;
  content: string;
  tags: string[];
  mtime: number;
}

export interface MemoryCandidate {
  note: MemoryNote;
  score: number;
  reasons: string[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'wie', 'was', 'und', 'oder', 'der', 'die', 'das', 'ein', 'eine',
  'bitte', 'please', 'about', 'from', 'into', 'todo', 'kurz', 'mal', 'so', 'ist', 'sind', 'auf', 'für', 'von', 'den',
]);

export function tokenizeMemoryQuery(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .map(token => token.trim())
        .filter(token => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ).slice(0, 24);
}

export function parseMemoryNote(file: TFile, raw: string): MemoryNote {
  const lines = raw.split('\n');
  let topic = file.basename;
  let tags: string[] = [];
  let contentStart = 0;

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
    if (end > 0) {
      const frontmatter = lines.slice(1, end).join('\n');
      const topicMatch = frontmatter.match(/^topic:\s*(.+)$/m);
      const tagsMatch = frontmatter.match(/^tags:\s*(.+)$/m);
      if (topicMatch) topic = topicMatch[1].trim();
      if (tagsMatch) {
        tags = tagsMatch[1]
          .split(/[,\s]+/)
          .map(tag => tag.trim().replace(/^#/, ''))
          .filter(Boolean);
      }
      contentStart = end + 1;
    }
  }

  const content = lines.slice(contentStart).join('\n').trim();

  return {
    path: file.path,
    topic,
    content,
    tags,
    mtime: file.stat.mtime,
  };
}

export async function loadMemoryNotes(
  vault: Vault,
  folderPath: string,
): Promise<MemoryNote[]> {
  const normalized = normalizePath(folderPath);
  const folder = vault.getAbstractFileByPath(normalized);
  if (!folder) return [];

  const files = vault.getMarkdownFiles().filter(file => file.path.startsWith(`${normalized}/`));
  const notes: MemoryNote[] = [];

  for (const file of files) {
    const raw = await vault.cachedRead(file).catch(() => '');
    if (!raw.trim()) continue;
    notes.push(parseMemoryNote(file, raw));
  }

  return notes.sort((a, b) => b.mtime - a.mtime);
}

export function rankMemoryNotes(
  query: string,
  notes: MemoryNote[],
  options: { limit?: number } = {},
): MemoryCandidate[] {
  const tokens = tokenizeMemoryQuery(query);
  if (tokens.length === 0 || notes.length === 0) return [];

  const limit = options.limit ?? 5;

  return notes
    .map((note): MemoryCandidate => {
      const topicLower = note.topic.toLowerCase();
      const contentLower = note.content.toLowerCase();
      const tagLower = note.tags.map(tag => tag.toLowerCase());
      let score = 0;
      const reasons: string[] = [];

      for (const token of tokens) {
        if (topicLower === token) {
          score += 25;
          reasons.push(`exact-topic:${token}`);
        } else if (topicLower.includes(token)) {
          score += 15;
          reasons.push(`topic:${token}`);
        }

        const tagIndex = tagLower.findIndex(tag => tag.includes(token));
        if (tagIndex >= 0) {
          score += 12;
          reasons.push(`tag:${note.tags[tagIndex]}`);
        }

        const contentHits = contentLower.split(token).length - 1;
        if (contentHits > 0) {
          score += Math.min(10, contentHits * 2);
          reasons.push(`content:${token}`);
        }
      }

      return { note, score, reasons };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime)
    .slice(0, limit);
}

export function formatMemoryContext(candidates: MemoryCandidate[]): string {
  if (candidates.length === 0) return '';

  const entries = candidates.map(candidate => {
    const { note } = candidate;
    const tagLine = note.tags.length > 0 ? ` (tags: ${note.tags.join(', ')})` : '';
    return `- **${note.topic}**${tagLine}\n  ${note.content.split('\n').join('\n  ')}`;
  });

  return `<memory_context>\nRelevant things I remember about this vault/user:\n\n${entries.join('\n\n')}\n</memory_context>`;
}

export async function storeMemory(
  vault: Vault,
  folderPath: string,
  topic: string,
  content: string,
  tags: string[] = [],
): Promise<string> {
  const normalized = normalizePath(folderPath);
  const safeTopic = topic.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  if (!safeTopic) throw new Error('Memory topic cannot be empty.');

  await vault.adapter.mkdir(normalized).catch(() => {
    // Best-effort; Obsidian creates parent folders automatically on write.
  });

  const filePath = normalizePath(`${normalized}/${safeTopic}.md`);
  const existing = vault.getAbstractFileByPath(filePath);

  const tagLine = tags.length > 0 ? `\ntags: ${tags.join(', ')}` : '';
  const frontmatter = `---\ntopic: ${topic}${tagLine}\n---\n\n${content.trim()}`;

  if (existing instanceof TFile) {
    await vault.modify(existing, frontmatter);
  } else {
    await vault.create(filePath, frontmatter);
  }

  return filePath;
}

export async function deleteMemory(app: App, filePath: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(normalizePath(filePath));
  if (file instanceof TFile) {
    await app.fileManager.trashFile(file);
  }
}

export async function ensureMemoryFolder(vault: Vault, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!vault.getAbstractFileByPath(normalized)) {
    await vault.createFolder(normalized).catch(() => {
      // Folder may already exist or platform doesn't allow creation.
    });
  }
}
