import type { TFile, Vault } from 'obsidian';

import { AgenticMemoryService } from '../../../../../src/core/intelligence/memory/AgenticMemoryService';

function createVault(): Vault {
  const files = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) => {
      if (files.has(path)) {
        return { path } as TFile;
      }
      return null;
    },
    getMarkdownFiles: () => Array.from(files.keys()).map(path => ({
      path,
      basename: path.split('/').pop()?.replace('.md', '') ?? '',
      stat: { mtime: Date.now() },
    })),
    cachedRead: async (file: { path: string }) => files.get(file.path) ?? '',
    create: async (path: string, content: string) => {
      files.set(path, content);
    },
    createFolder: async () => {},
    modify: async (file: { path: string }, content: string) => {
      files.set(file.path, content);
    },
  } as unknown as Vault;
}

describe('AgenticMemoryService', () => {
  it('remembers and recalls facts', async () => {
    const vault = createVault();
    const memory = new AgenticMemoryService(vault);

    await memory.remember({
      topic: 'Obsidian Paths',
      content: 'Always use relative paths in the vault.',
      tags: ['convention'],
      confidence: 0.9,
    });

    const facts = await memory.recall({ topic: 'obsidian' });
    expect(facts).toHaveLength(1);
    expect(facts[0].topic).toBe('Obsidian Paths');
  });

  it('filters by tag', async () => {
    const vault = createVault();
    const memory = new AgenticMemoryService(vault);

    await memory.remember({ topic: 'A', content: 'a', tags: ['code'], confidence: 0.8 });
    await memory.remember({ topic: 'B', content: 'b', tags: ['writing'], confidence: 0.8 });

    const facts = await memory.recall({ tags: ['code'] });
    expect(facts).toHaveLength(1);
    expect(facts[0].topic).toBe('A');
  });
});
