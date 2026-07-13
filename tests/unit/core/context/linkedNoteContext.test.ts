import { buildLinkedNoteContext } from '@/core/context/linkedNoteContext';

describe('buildLinkedNoteContext', () => {
  it('includes outgoing and incoming linked notes in a bounded envelope', async () => {
    const files: Record<string, string> = {
      'linked.md': '# Linked\nRelevant detail',
      'backlink.md': '# Backlink\nAnother detail',
    };
    const app = {
      metadataCache: {
        resolvedLinks: {
          'source.md': { 'linked.md': 2 },
          'backlink.md': { 'source.md': 1 },
        },
      },
      vault: { adapter: { read: jest.fn(async (path: string) => files[path]) } },
    } as any;
    const result = await buildLinkedNoteContext(app, 'source.md');
    expect(result).toContain('<graph_context>');
    expect(result).toContain('[[linked.md]]');
    expect(result).toContain('[[backlink.md]]');
  });

  it('returns empty context without a current note', async () => {
    expect(await buildLinkedNoteContext({} as any, null)).toBe('');
  });
});
