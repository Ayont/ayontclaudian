import type { TFile } from 'obsidian';

import type { MemoryNote } from '../../../../src/core/memory/memoryService';
import {
  formatMemoryContext,
  parseMemoryNote,
  rankMemoryNotes,
  tokenizeMemoryQuery,
} from '../../../../src/core/memory/memoryService';

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
