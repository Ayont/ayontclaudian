import { buildDiffPreview, summarizeDiffPreview } from '@/core/diff/diffPreview';

describe('diffPreview', () => {
  it('builds write preview from tool input', () => {
    const preview = buildDiffPreview('Write', { file_path: 'a.md', content: 'one\ntwo' });
    expect(preview?.diffs[0].stats.added).toBe(2);
    expect(summarizeDiffPreview(preview!)).toBe('a.md (+2/-0)');
  });

  it('builds apply_patch preview', () => {
    const preview = buildDiffPreview('apply_patch', {
      patch: '*** Begin Patch\n*** Add File: a.md\n+hello\n*** End Patch',
    });
    expect(preview?.diffs[0].filePath).toBe('a.md');
    expect(preview?.diffs[0].stats.added).toBe(1);
  });
});
