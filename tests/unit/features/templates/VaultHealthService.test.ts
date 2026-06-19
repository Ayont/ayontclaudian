import { TFile, type App, type CachedMetadata } from 'obsidian';

import { VaultHealthService } from '@/features/templates/VaultHealthService';

function createMockApp(markdownFiles: Array<{ path: string; content: string; cache?: CachedMetadata }> = []): App {
  const files = new Map(markdownFiles.map((f) => [f.path, f]));

  return {
    vault: {
      getMarkdownFiles: jest.fn(() =>
        Array.from(files.values()).map(
          (f) =>
            ({
              path: f.path,
              basename: f.path.split('/').pop()?.replace(/\.md$/, '') || f.path,
              extension: 'md',
            }) as unknown as TFile,
        ),
      ),
      read: jest.fn(async (file: TFile) => {
        const entry = files.get(file.path);
        if (!entry) throw new Error(`File not found: ${file.path}`);
        return entry.content;
      }),
    },
    metadataCache: {
      getFileCache: jest.fn((file: TFile) => {
        const entry = files.get(file.path);
        return entry?.cache ?? null;
      }),
      getFirstLinkpathDest: jest.fn((linkpath: string, _sourcePath: string) => {
        const target = Array.from(files.values()).find(
          (f) => f.path.replace(/\.md$/, '').toLowerCase() === linkpath.toLowerCase(),
        );
        return target
          ? ({
              path: target.path,
              basename: target.path.split('/').pop()?.replace(/\.md$/, '') || target.path,
            } as unknown as TFile)
          : null;
      }),
    },
  } as unknown as App;
}

describe('VaultHealthService', () => {
  it('finds orphaned notes', async () => {
    const app = createMockApp([
      { path: 'linked.md', content: 'I am referenced.' },
      { path: 'orphan.md', content: 'No one links here.' },
      { path: 'index.md', content: '[[linked]]' },
    ]);
    const service = new VaultHealthService(app);
    const result = await service.orphanCheck();

    expect(result.command).toBe('orphan-check');
    const paths = result.items.map((i) => i.path);
    expect(paths).toContain('orphan.md');
    expect(paths).not.toContain('linked.md');
  });

  it('finds tag variations', async () => {
    const app = createMockApp([
      {
        path: 'a.md',
        content: '#tag1',
        cache: { tags: [{ tag: '#tag1', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } } }] } as unknown as CachedMetadata,
      },
      {
        path: 'b.md',
        content: '#Tag1',
        cache: { tags: [{ tag: '#Tag1', position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } } }] } as unknown as CachedMetadata,
      },
    ]);
    const service = new VaultHealthService(app);
    const result = await service.tagDedupe();

    expect(result.command).toBe('tag-dedupe');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe('#tag1');
    expect(result.items[0].description).toContain('#tag1');
    expect(result.items[0].description).toContain('#Tag1');
  });

  it('suggests links for unlinked mentions', async () => {
    const app = createMockApp([
      { path: 'target.md', content: 'I am a note.' },
      { path: 'source.md', content: 'This mentions target but does not link it.' },
    ]);
    const service = new VaultHealthService(app);
    const result = await service.linkSuggest();

    expect(result.command).toBe('link-suggest');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0].path).toBe('source.md');
    expect(result.items[0].description).toContain('target');
  });

  it('finds potential duplicates', async () => {
    const app = createMockApp([
      { path: 'note-a.md', content: 'apple banana cherry date elderberry' },
      { path: 'note-b.md', content: 'apple banana cherry date elderberry fig' },
    ]);
    const service = new VaultHealthService(app);
    const result = await service.dedupe();

    expect(result.command).toBe('dedupe');
    expect(result.items.length).toBeGreaterThan(0);
  });
});
