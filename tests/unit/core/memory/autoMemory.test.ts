import type { Vault } from 'obsidian';

import { parseAutoMemoryBlocks, persistAutoMemories } from '../../../../src/core/memory/autoMemory';
import { loadMemoryNotes } from '../../../../src/core/memory/memoryService';

function createAdapterVault(): Vault & { __files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    __files: files,
    getAbstractFileByPath: () => null,
    getMarkdownFiles: () => [],
    adapter: {
      exists: async (path: string) =>
        files.has(path) || Array.from(files.keys()).some(p => p.startsWith(`${path}/`)),
      mkdir: async () => {},
      read: async (path: string) => {
        const content = files.get(path);
        if (content === undefined) throw new Error(`Not found: ${path}`);
        return content;
      },
      write: async (path: string, content: string) => {
        files.set(path, content);
      },
      remove: async (path: string) => {
        files.delete(path);
      },
      list: async (folder: string) => ({
        files: Array.from(files.keys()).filter(p => p.startsWith(`${folder}/`)),
        folders: [],
      }),
      stat: async () => ({ mtime: 1_700_000_000_000, ctime: 0, size: 0, type: 'file' }),
    },
  } as unknown as Vault & { __files: Map<string, string> };
}

const FULL_BLOCK = [
  'Hier die Antwort auf deine Frage.',
  '',
  '```claudian-memory',
  'topic: Veylor Server-Stack',
  'tags: veylor, infrastruktur',
  '---',
  'Pluto 26.1.2 mit Java 25 und 48GB ZGC.',
  '```',
].join('\n');

describe('parseAutoMemoryBlocks', () => {
  it('parses topic, tags, and content from a complete block', () => {
    const blocks = parseAutoMemoryBlocks(FULL_BLOCK);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      topic: 'Veylor Server-Stack',
      tags: ['veylor', 'infrastruktur'],
      content: 'Pluto 26.1.2 mit Java 25 und 48GB ZGC.',
      closed: true,
    });
  });

  it('marks a still-streaming fence as not closed', () => {
    const streaming = '```claudian-memory\ntopic: Halb\n---\nNoch nicht fert';

    const blocks = parseAutoMemoryBlocks(streaming);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(false);
  });

  it('tolerates a missing tags line', () => {
    const md = '```claudian-memory\ntopic: Nur Topic\n---\nInhalt.\n```';

    const [block] = parseAutoMemoryBlocks(md);

    expect(block.topic).toBe('Nur Topic');
    expect(block.tags).toEqual([]);
    expect(block.content).toBe('Inhalt.');
  });

  it('returns empty array when no fence is present', () => {
    expect(parseAutoMemoryBlocks('Ganz normale Antwort ohne Memory.')).toEqual([]);
  });

  it('does not match other fenced languages', () => {
    expect(parseAutoMemoryBlocks('```network-map\nA --> B\n```')).toEqual([]);
  });

  it('parses multiple blocks in document order', () => {
    const md = `${FULL_BLOCK}\n\nText dazwischen.\n\n\`\`\`claudian-memory\ntopic: Zweites\n---\nZwei.\n\`\`\``;

    const blocks = parseAutoMemoryBlocks(md);

    expect(blocks.map(b => b.topic)).toEqual(['Veylor Server-Stack', 'Zweites']);
  });
});

describe('persistAutoMemories', () => {
  it('stores complete blocks into the memory folder', async () => {
    const vault = createAdapterVault();

    const stored = await persistAutoMemories(vault, '.claudian/memory', FULL_BLOCK);

    expect(stored).toEqual(['.claudian/memory/veylor-server-stack.md']);
    const notes = await loadMemoryNotes(vault, '.claudian/memory');
    expect(notes).toHaveLength(1);
    expect(notes[0].topic).toBe('Veylor Server-Stack');
    expect(notes[0].tags).toEqual(['veylor', 'infrastruktur']);
  });

  it('is idempotent per topic (same slug overwrites)', async () => {
    const vault = createAdapterVault();

    await persistAutoMemories(vault, '.claudian/memory', FULL_BLOCK);
    await persistAutoMemories(vault, '.claudian/memory', FULL_BLOCK);

    expect(await loadMemoryNotes(vault, '.claudian/memory')).toHaveLength(1);
  });

  it('skips unclosed and incomplete blocks', async () => {
    const vault = createAdapterVault();
    const md = '```claudian-memory\ntopic: Offen\n---\nStreaming…';

    const stored = await persistAutoMemories(vault, '.claudian/memory', md);

    expect(stored).toEqual([]);
    expect(vault.__files.size).toBe(0);
  });

  it('does nothing for content without memory fences', async () => {
    const vault = createAdapterVault();

    const stored = await persistAutoMemories(vault, '.claudian/memory', 'Normale Antwort.');

    expect(stored).toEqual([]);
  });
});
