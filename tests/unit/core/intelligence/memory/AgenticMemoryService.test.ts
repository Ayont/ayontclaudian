import type { Vault } from 'obsidian';

import { AgenticMemoryService } from '../../../../../src/core/intelligence/memory/AgenticMemoryService';

/**
 * Adapter-based vault mock. The real Obsidian vault index (getMarkdownFiles,
 * getAbstractFileByPath, vault.create) NEVER sees hidden `.claudian/` folders —
 * mocking those APIs previously hid exactly the bug where recall always
 * returned 0 facts. The service must work against `vault.adapter` alone.
 */
function createVault(): Vault & { __files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    __files: files,
    // Vault-index APIs return nothing for hidden paths — exactly like Obsidian.
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
      stat: async () => ({ mtime: Date.now(), ctime: Date.now(), size: 0, type: 'file' }),
    },
  } as unknown as Vault & { __files: Map<string, string> };
}

describe('AgenticMemoryService', () => {
  it('remembers and recalls facts from the hidden dot-folder', async () => {
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

  it('count() returns the number of stored facts', async () => {
    const vault = createVault();
    const memory = new AgenticMemoryService(vault);

    expect(await memory.count()).toBe(0);

    await memory.remember({ topic: 'One', content: '1', tags: [], confidence: 0.5 });
    await memory.remember({ topic: 'Two', content: '2', tags: [], confidence: 0.5 });

    expect(await memory.count()).toBe(2);
  });

  it('never touches the vault index (hidden folders are invisible to it)', async () => {
    const vault = createVault();
    const indexSpy = jest.spyOn(vault, 'getMarkdownFiles');
    const memory = new AgenticMemoryService(vault);

    await memory.remember({ topic: 'X', content: 'x', tags: [], confidence: 0.5 });
    await memory.recall({});
    await memory.count();

    expect(indexSpy).not.toHaveBeenCalled();
  });
});
