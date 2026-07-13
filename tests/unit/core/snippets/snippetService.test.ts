import type { Vault } from 'obsidian';

import {
  deleteSnippet,
  listSnippets,
  parseSnippet,
  saveSnippet,
} from '@/core/snippets/snippetService';

function createMockVault(files: Record<string, string> = {}): Vault {
  const data = { ...files };
  const dirs = new Set<string>();
  return {
    adapter: {
      exists: async (path: string) => path in data || dirs.has(path),
      read: async (path: string) => data[path] ?? '',
      write: async (path: string, content: string) => {
        data[path] = content;
        // Track parent dir
        const parts = path.split('/');
        parts.pop();
        if (parts.length > 0) dirs.add(parts.join('/'));
      },
      remove: async (path: string) => { delete data[path]; },
      mkdir: async (path: string) => { dirs.add(path); },
      list: async (path: string) => ({
        files: Object.keys(data).filter((k) => k.startsWith(path + '/') && k.endsWith('.md')),
        folders: [],
      }),
    },
  } as unknown as Vault;
}

describe('parseSnippet', () => {
  it('parses frontmatter + body', () => {
    const raw = `---
name: "CERTUSS Ticket"
tags: [certuss, ticket]
created: 1700000000000
---

Formatiere als CERTUSS-Ticket nach HUNARI-Schema`;
    const snippet = parseSnippet(raw, 'certuss-ticket.md');
    expect(snippet.name).toBe('CERTUSS Ticket');
    expect(snippet.tags).toEqual(['certuss', 'ticket']);
    expect(snippet.body).toBe('Formatiere als CERTUSS-Ticket nach HUNARI-Schema');
    expect(snippet.createdAt).toBe(1700000000000);
  });

  it('handles missing frontmatter', () => {
    const snippet = parseSnippet('Just some text', 'simple.md');
    expect(snippet.name).toBe('simple');
    expect(snippet.body).toBe('Just some text');
    expect(snippet.tags).toEqual([]);
  });
});

describe('saveSnippet + listSnippets + deleteSnippet', () => {
  it('round-trips save → list → delete', async () => {
    const vault = createMockVault();
    await saveSnippet(vault, 'Test Prompt', 'Hello world', ['test']);
    const listed = await listSnippets(vault);
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe('Test Prompt');
    expect(listed[0].body).toBe('Hello world');
    expect(listed[0].tags).toEqual(['test']);

    const deleted = await deleteSnippet(vault, 'Test Prompt');
    expect(deleted).toBe(true);
    const after = await listSnippets(vault);
    expect(after).toHaveLength(0);
  });

  it('lists multiple snippets sorted by createdAt desc', async () => {
    const vault = createMockVault();
    await saveSnippet(vault, 'Old', 'first', []);
    await new Promise((r) => setTimeout(r, 5));
    await saveSnippet(vault, 'New', 'second', []);
    const listed = await listSnippets(vault);
    expect(listed).toHaveLength(2);
    expect(listed[0].name).toBe('New');
  });

  it('returns empty array when folder does not exist', async () => {
    const vault = createMockVault();
    const listed = await listSnippets(vault);
    expect(listed).toEqual([]);
  });

  it('deleteSnippet returns false for missing snippet', async () => {
    const vault = createMockVault();
    const result = await deleteSnippet(vault, 'Nonexistent');
    expect(result).toBe(false);
  });
});
