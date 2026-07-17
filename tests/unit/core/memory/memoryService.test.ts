import type { TFile, Vault } from 'obsidian';

import type { MemoryNote } from '../../../../src/core/memory/memoryService';
import {
  formatMemoryContext,
  loadMemoryNotes,
  parseMemoryNote,
  rankMemoryNotes,
  storeMemory,
  tokenizeMemoryQuery,
} from '../../../../src/core/memory/memoryService';

/**
 * Adapter-based vault mock — mirrors real Obsidian behavior where the vault
 * index NEVER exposes hidden `.claudian/` folders. Memory storage must work
 * purely via `vault.adapter`.
 */
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

describe('tokenizeMemoryQuery', () => {
  it('removes stopwords and short tokens', () => {
    expect(tokenizeMemoryQuery('Was ist das beste Plugin für Obsidian?')).toEqual([
      'beste',
      'plugin',
      'obsidian',
    ]);
  });

  it('deduplicates tokens', () => {
    expect(tokenizeMemoryQuery('obsidian obsidian plugin')).toEqual(['obsidian', 'plugin']);
  });

  it('returns empty array for stopword-only input', () => {
    expect(tokenizeMemoryQuery('was ist und der die das')).toEqual([]);
  });
});

describe('parseMemoryNote', () => {
  it('parses frontmatter and content', () => {
    const file = {
      path: '.claudian/memory/test.md',
      basename: 'test',
      stat: { mtime: 1_700_000_000_000 },
    } as unknown as TFile;
    const raw = `---\ntopic: My Topic\ntags: coding, typescript\n---\n\nThis is the memory content.`;
    const note = parseMemoryNote(file, raw);
    expect(note.topic).toBe('My Topic');
    expect(note.tags).toEqual(['coding', 'typescript']);
    expect(note.content).toBe('This is the memory content.');
  });

  it('falls back to basename when no frontmatter topic exists', () => {
    const file = {
      path: '.claudian/memory/fallback.md',
      basename: 'fallback',
      stat: { mtime: 1_700_000_000_000 },
    } as unknown as TFile;
    const note = parseMemoryNote(file, 'Just content.');
    expect(note.topic).toBe('fallback');
    expect(note.tags).toEqual([]);
  });
});

describe('rankMemoryNotes', () => {
  const now = Date.now();
  const notes: MemoryNote[] = [
    {
      path: 'a.md',
      topic: 'Obsidian Plugin',
      content: 'Build plugins with TypeScript.',
      tags: ['coding'],
      mtime: now,
    },
    {
      path: 'b.md',
      topic: 'Cooking',
      content: 'Recipes for pasta.',
      tags: ['food'],
      mtime: now - 86_400_000,
    },
    {
      path: 'c.md',
      topic: 'Travel',
      content: 'Notes about Japan.',
      tags: ['japan'],
      mtime: now - 86_400_000 * 60,
    },
  ];

  it('ranks topic matches highest', () => {
    const candidates = rankMemoryNotes('obsidian plugin', notes, { limit: 2 });
    expect(candidates[0].note.topic).toBe('Obsidian Plugin');
    expect(candidates[0].score).toBeGreaterThan(20);
  });

  it('considers content matches', () => {
    const candidates = rankMemoryNotes('pasta recipe', notes, { limit: 2 });
    expect(candidates[0].note.topic).toBe('Cooking');
  });

  it('considers tag matches', () => {
    const candidates = rankMemoryNotes('japan travel', notes, { limit: 2 });
    expect(candidates[0].note.topic).toBe('Travel');
  });

  it('returns empty array when nothing matches', () => {
    const candidates = rankMemoryNotes('quantum physics', notes);
    expect(candidates).toEqual([]);
  });

});

describe('formatMemoryContext', () => {
  it('returns empty string for no candidates', () => {
    expect(formatMemoryContext([])).toBe('');
  });

  it('formats candidates as memory context block', () => {
    const candidates = [
      {
        note: {
          path: 'a.md',
          topic: 'Obsidian',
          content: 'Use relative paths.',
          tags: ['tips'],
          mtime: Date.now(),
        },
        score: 10,
        reasons: [],
      },
    ];
    const output = formatMemoryContext(candidates);
    expect(output).toContain('<memory_context>');
    expect(output).toContain('**Obsidian**');
    expect(output).toContain('Use relative paths.');
    expect(output).toContain('tags: tips');
  });
});

describe('storeMemory & loadMemoryNotes (hidden dot-folder)', () => {
  it('stores via adapter and loads it back from .claudian/memory', async () => {
    // Regression: memory lived in a hidden folder the vault index can't see —
    // loadMemoryNotes used getMarkdownFiles() and ALWAYS returned []. It must
    // enumerate via vault.adapter instead.
    const vault = createAdapterVault();

    const path = await storeMemory(vault, '.claudian/memory', 'Veylor Setup', 'MongoDB via en2do.', ['veylor']);
    expect(path).toBe('.claudian/memory/veylor-setup.md');

    const notes = await loadMemoryNotes(vault, '.claudian/memory');
    expect(notes).toHaveLength(1);
    expect(notes[0].topic).toBe('Veylor Setup');
    expect(notes[0].content).toBe('MongoDB via en2do.');
    expect(notes[0].tags).toEqual(['veylor']);
  });

  it('loadMemoryNotes never consults the vault index', async () => {
    const vault = createAdapterVault();
    const indexSpy = jest.spyOn(vault, 'getMarkdownFiles');
    await storeMemory(vault, '.claudian/memory', 'A', 'a');

    await loadMemoryNotes(vault, '.claudian/memory');

    expect(indexSpy).not.toHaveBeenCalled();
  });

  it('returns empty array for a missing folder', async () => {
    const vault = createAdapterVault();
    expect(await loadMemoryNotes(vault, '.claudian/memory')).toEqual([]);
  });

  it('storeMemory overwrites an existing memory with the same topic', async () => {
    const vault = createAdapterVault();
    await storeMemory(vault, '.claudian/memory', 'Topic', 'old');
    await storeMemory(vault, '.claudian/memory', 'Topic', 'new');

    const notes = await loadMemoryNotes(vault, '.claudian/memory');
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe('new');
  });

  it('ignores non-markdown files in the memory folder', async () => {
    const vault = createAdapterVault();
    await storeMemory(vault, '.claudian/memory', 'Real', 'content');
    vault.__files.set('.claudian/memory/manifest.json', '{}');

    const notes = await loadMemoryNotes(vault, '.claudian/memory');
    expect(notes).toHaveLength(1);
  });

  it('keeps German umlauts/accents in the slug (Unicode-aware)', async () => {
    // Regression: an ASCII-only `\w` slug stripped umlauts ("Bücher" → "bcher")
    // and collapsed distinct accented topics onto the same file, overwriting
    // each other. The slug must preserve non-ASCII letters.
    const vault = createAdapterVault();
    const path = await storeMemory(vault, '.claudian/memory', 'Ölpreis Strategie', 'content');
    expect(path).toBe('.claudian/memory/ölpreis-strategie.md');
  });

  it('does not collide two topics that differ only in accents', async () => {
    const vault = createAdapterVault();
    await storeMemory(vault, '.claudian/memory', 'Cafe', 'ascii');
    await storeMemory(vault, '.claudian/memory', 'Café', 'accented');

    const notes = await loadMemoryNotes(vault, '.claudian/memory');
    expect(notes).toHaveLength(2);
  });
});
