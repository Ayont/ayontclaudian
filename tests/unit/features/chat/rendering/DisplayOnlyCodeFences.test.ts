import { createMockEl } from '@test/helpers/mockElement';

import {
  prepareDisplayOnlyCodeFences,
  restoreDisplayOnlyCodeFences,
} from '@/features/chat/rendering/DisplayOnlyCodeFences';

describe('prepareDisplayOnlyCodeFences', () => {
  it('rewrites a language fence so Obsidian cannot dispatch a processor', () => {
    const prepared = prepareDisplayOnlyCodeFences('```dataview\nLIST\n```');
    expect(prepared.markdown).toBe('```claudian-display-only-fence-0\nLIST\n```');
    expect(prepared.fences).toEqual([
      { placeholderLanguage: 'claudian-display-only-fence-0', originalLanguage: 'dataview' },
    ]);
  });

  it('leaves unlabeled fences and prose alone', () => {
    const source = 'hello\n```\nplain\n```\n';
    expect(prepareDisplayOnlyCodeFences(source).markdown).toBe(source);
    expect(prepareDisplayOnlyCodeFences(source).fences).toEqual([]);
  });

  it('keeps fence info after the language token', () => {
    const prepared = prepareDisplayOnlyCodeFences('```ts {title="a.ts"}\nconst n = 1;\n```');
    expect(prepared.markdown).toBe('```claudian-display-only-fence-0 {title="a.ts"}\nconst n = 1;\n```');
    expect(prepared.fences[0].originalLanguage).toBe('ts');
  });

  it('rewrites multiple fences independently', () => {
    const prepared = prepareDisplayOnlyCodeFences('```js\na\n```\n\n```templater\nb\n```');
    expect(prepared.markdown).toContain('claudian-display-only-fence-0');
    expect(prepared.markdown).toContain('claudian-display-only-fence-1');
    expect(prepared.fences.map((fence) => fence.originalLanguage)).toEqual(['js', 'templater']);
  });

});

describe('restoreDisplayOnlyCodeFences', () => {
  it('puts the original language class back after render', async () => {
    const root = createMockEl();
    const code = root.createEl('code');
    code.className = 'language-claudian-display-only-fence-0';

    await restoreDisplayOnlyCodeFences(root as unknown as HTMLElement, [
      { placeholderLanguage: 'claudian-display-only-fence-0', originalLanguage: 'dataview' },
    ]);

    expect(code.className).toBe('language-dataview');
  });

  it('restores the code element when Obsidian adds the placeholder to pre and code', async () => {
    const root = createMockEl();
    const pre = root.createEl('pre');
    pre.className = 'language-claudian-display-only-fence-0';
    const code = pre.createEl('code');
    code.className = 'language-claudian-display-only-fence-0';

    await restoreDisplayOnlyCodeFences(root as unknown as HTMLElement, [
      { placeholderLanguage: 'claudian-display-only-fence-0', originalLanguage: 'claudian-document' },
    ]);

    expect(code.className).toBe('language-claudian-document');
  });
});
