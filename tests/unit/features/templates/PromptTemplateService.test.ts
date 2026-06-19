import { TFile, type App, type TFolder } from 'obsidian';

import {
  BUILT_IN_TEMPLATES,
  DEFAULT_TEMPLATE_FOLDER,
  PromptTemplateService,
  substituteTemplateVariables,
  type TemplateContext,
} from '@/features/templates/PromptTemplateService';

function createMockApp(templates: Record<string, string> = {}): App {
  const files = new Map<string, string>(Object.entries(templates));

  const folder: TFolder = {
    path: DEFAULT_TEMPLATE_FOLDER,
    name: DEFAULT_TEMPLATE_FOLDER.split('/').pop() || DEFAULT_TEMPLATE_FOLDER,
    children: [] as Array<TFile | TFolder>,
    vault: {} as any,
    parent: null,
  } as unknown as TFolder;

  for (const [path, content] of files) {
    const file: TFile = {
      path,
      name: path.split('/').pop() || path,
      basename: path.split('/').pop()?.replace(/\.md$/, '') || path,
      extension: 'md',
      parent: folder,
      vault: {} as any,
    } as unknown as TFile;
    (folder as any).children.push(file);
  }

  return {
    vault: {
      getAbstractFileByPath: jest.fn((path: string) => {
        if (path === DEFAULT_TEMPLATE_FOLDER) return folder;
        return (folder.children as TFile[]).find((c) => c.path === path) ?? null;
      }),
      read: jest.fn(async (file: TFile) => {
        const content = files.get(file.path);
        if (content === undefined) throw new Error(`File not found: ${file.path}`);
        return content;
      }),
    },
  } as unknown as App;
}

describe('PromptTemplateService', () => {
  it('returns built-in templates', async () => {
    const service = new PromptTemplateService(createMockApp());
    const templates = await service.listTemplates();
    const names = templates.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(BUILT_IN_TEMPLATES.map((t) => t.name)));
  });

  it('loads vault templates from the default folder', async () => {
    const app = createMockApp({
      [`${DEFAULT_TEMPLATE_FOLDER}/custom.md`]:
        '---\nname: Custom Template\ndescription: A custom prompt\n---\n\nHello {{selection}}',
    });
    const service = new PromptTemplateService(app);
    const templates = await service.listTemplates();

    const custom = templates.find((t) => t.name === 'Custom Template');
    expect(custom).toBeDefined();
    expect(custom?.description).toBe('A custom prompt');
    expect(custom?.body).toContain('Hello {{selection}}');
  });

  it('parses H1 and blockquote when no frontmatter', async () => {
    const app = createMockApp({
      [`${DEFAULT_TEMPLATE_FOLDER}/simple.md`]:
        '# Simple Template\n> Simple description\n\nSummarize: {{note}}',
    });
    const service = new PromptTemplateService(app);
    const templates = await service.listTemplates();

    const simple = templates.find((t) => t.name === 'Simple Template');
    expect(simple).toBeDefined();
    expect(simple?.description).toBe('Simple description');
  });

  it('expands template variables', () => {
    const service = new PromptTemplateService(createMockApp());
    const template = {
      name: 'test',
      description: '',
      body: 'Date: {{date}}, Title: {{title}}, Tags: {{tags}}, Missing: {{unknown}}',
      filePath: '',
    };
    const ctx: TemplateContext = {
      noteTitle: 'My Note',
      noteTags: ['a', 'b'],
    };

    const result = service.expand(template, ctx);

    expect(result).toContain('Title: My Note');
    expect(result).toContain('Tags: a, b');
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    expect(result).toContain('Missing: {{unknown}}');
  });

  it('getTemplate finds a template by name', async () => {
    const service = new PromptTemplateService(createMockApp());
    const templates = await service.listTemplates();
    const found = service.getTemplate('code-review', templates);
    expect(found).toBeDefined();
    expect(found?.name).toBe('code-review');
  });
});

describe('substituteTemplateVariables', () => {
  it('replaces known placeholders', () => {
    const result = substituteTemplateVariables('{{selection}} and {{title}}', {
      selection: 'hello',
      noteTitle: 'world',
    });
    expect(result).toBe('hello and world');
  });

  it('leaves unknown placeholders intact', () => {
    const result = substituteTemplateVariables('{{unknown}}', {});
    expect(result).toBe('{{unknown}}');
  });
});
