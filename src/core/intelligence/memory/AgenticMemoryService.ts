import type { TFile, Vault } from 'obsidian';

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\//, '').replace(/\/$/, '');
}

import { globalEventBus } from '../../events/EventBus';

export interface MemoryFact {
  id: string;
  topic: string;
  content: string;
  tags: string[];
  confidence: number; // 0-1
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryQuery {
  topic?: string;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
}

const MEMORY_FOLDER = '.claudian/memory-v2';

export class AgenticMemoryService {
  constructor(private readonly vault: Vault) {}

  async ensureFolder(): Promise<void> {
    const folder = normalizePath(MEMORY_FOLDER);
    if (!this.vault.getAbstractFileByPath(folder)) {
      await this.vault.createFolder(folder).catch(() => {
        // May already exist.
      });
    }
  }

  async remember(fact: Omit<MemoryFact, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    await this.ensureFolder();
    const id = fact.topic.toLowerCase().replace(/[^\w]+/g, '-');
    const now = Date.now();
    const full: MemoryFact = { ...fact, id, createdAt: now, updatedAt: now };
    const path = normalizePath(`${MEMORY_FOLDER}/${id}.md`);
    const content = this.serializeFact(full);

    const existing = this.vault.getAbstractFileByPath(path);
    if (existing) {
      await this.vault.modify(existing as TFile, content);
    } else {
      await this.vault.create(path, content);
    }

    globalEventBus.emit('memory:updated', { id, topic: full.topic });
    return id;
  }

  async recall(query: MemoryQuery = {}): Promise<MemoryFact[]> {
    const folder = normalizePath(MEMORY_FOLDER);
    const files = this.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${folder}/`));
    const facts: MemoryFact[] = [];

    for (const file of files) {
      const raw = await this.vault.cachedRead(file).catch(() => '');
      const fact = this.parseFact(file.basename, raw);
      if (this.matchesQuery(fact, query)) {
        facts.push(fact);
      }
    }

    return facts
      .filter(f => f.confidence >= (query.minConfidence ?? 0))
      .filter(f => !f.expiresAt || f.expiresAt > Date.now())
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
      .slice(0, query.limit ?? 10);
  }

  private serializeFact(fact: MemoryFact): string {
    const frontmatter = [
      '---',
      `topic: ${fact.topic}`,
      `tags: ${fact.tags.join(', ')}`,
      `confidence: ${fact.confidence}`,
      ...(fact.expiresAt ? [`expiresAt: ${fact.expiresAt}`] : []),
      `createdAt: ${fact.createdAt}`,
      `updatedAt: ${fact.updatedAt}`,
      '---',
      '',
      fact.content,
    ].join('\n');
    return frontmatter;
  }

  private parseFact(id: string, raw: string): MemoryFact {
    const lines = raw.split('\n');
    let topic = id;
    let tags: string[] = [];
    let confidence = 0.5;
    let expiresAt: number | undefined;
    let createdAt = 0;
    let updatedAt = 0;
    let contentStart = 0;

    if (lines[0]?.trim() === '---') {
      const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
      if (end > 0) {
        for (let i = 1; i < end; i++) {
          const line = lines[i];
          const [key, value] = line.split(':').map(s => s.trim());
          switch (key) {
            case 'topic': topic = value; break;
            case 'tags': tags = value.split(',').map(t => t.trim()).filter(Boolean); break;
            case 'confidence': confidence = parseFloat(value) ?? 0.5; break;
            case 'expiresAt': expiresAt = parseInt(value, 10); break;
            case 'createdAt': createdAt = parseInt(value, 10); break;
            case 'updatedAt': updatedAt = parseInt(value, 10); break;
          }
        }
        contentStart = end + 1;
      }
    }

    return {
      id,
      topic,
      content: lines.slice(contentStart).join('\n').trim(),
      tags,
      confidence,
      expiresAt,
      createdAt,
      updatedAt,
    };
  }

  private matchesQuery(fact: MemoryFact, query: MemoryQuery): boolean {
    if (query.topic && !fact.topic.toLowerCase().includes(query.topic.toLowerCase())) {
      return false;
    }
    if (query.tags && !query.tags.some(tag => fact.tags.includes(tag))) {
      return false;
    }
    return true;
  }
}
