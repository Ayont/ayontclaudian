import { createMockEl } from '@test/helpers/mockElement';

import {
  containsMermaidFence,
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

  it('lets mermaid fences through so Obsidian can render mindmaps and flowcharts', () => {
    const source = '```mermaid\nmindmap\n  root((Thema))\n```';
    const prepared = prepareDisplayOnlyCodeFences(source);
    expect(prepared.markdown).toBe(source);
    expect(prepared.fences).toEqual([]);
  });

  it('rewrites mermaid while streaming so Obsidian cannot re-init the diagram', () => {
    const source = '```mermaid\nmindmap\n  root((Thema))\n```';
    const prepared = prepareDisplayOnlyCodeFences(source, { passthroughMermaid: false });
    expect(prepared.markdown).toBe('```claudian-display-only-fence-0\nmindmap\n  root((Thema))\n```');
    expect(prepared.fences).toEqual([
      { placeholderLanguage: 'claudian-display-only-fence-0', originalLanguage: 'mermaid' },
    ]);
  });

  it('still rewrites mermaid on the streaming path when dataview is in the same answer', () => {
    const prepared = prepareDisplayOnlyCodeFences(
      '```mermaid\nflowchart TD\nA-->B\n```\n\n```dataview\nLIST\n```',
      { passthroughMermaid: false },
    );
    expect(prepared.markdown).not.toContain('```mermaid\n');
    expect(prepared.fences.map((fence) => fence.originalLanguage)).toEqual(['mermaid', 'dataview']);
  });

  it('still rewrites dataview when mermaid is in the same answer', () => {
    const prepared = prepareDisplayOnlyCodeFences('```mermaid\nflowchart TD\nA-->B\n```\n\n```dataview\nLIST\n```');
    expect(prepared.markdown).toContain('```mermaid\n');
    expect(prepared.markdown).toContain('claudian-display-only-fence-0');
    expect(prepared.fences.map((fence) => fence.originalLanguage)).toEqual(['dataview']);
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

describe('containsMermaidFence', () => {
  it('detects backtick and tilde mermaid openers, including unfinished streams', () => {
    expect(containsMermaidFence('```mermaid\nflowchart TD')).toBe(true);
    expect(containsMermaidFence('~~~mermaid\nmindmap')).toBe(true);
    expect(containsMermaidFence('``` mermaid\ngraph TD')).toBe(true);
    expect(containsMermaidFence('```js\nconst a = 1\n```')).toBe(false);
  });
});
