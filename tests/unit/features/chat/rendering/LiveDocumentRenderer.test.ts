/** @jest-environment jsdom */

import {
  parseLiveDocument,
  parseLiveDocumentBlocks,
  renderLiveDocument,
  renderLiveDocuments,
} from '@/features/chat/rendering/LiveDocumentRenderer';

function installObsidianDomHelpers(): void {
  const createChild = function createChild(
    this: HTMLElement,
    tag: string,
    options?: { cls?: string; text?: string; attr?: Record<string, string> },
  ) {
    const element = document.createElement(tag);
    if (options?.cls) element.className = options.cls;
    if (options?.text) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.appendChild(element);
    return element;
  };
  (HTMLElement.prototype as any).createDiv = function createDiv(options?: unknown) {
    return createChild.call(this, 'div', options as any);
  };
  (HTMLElement.prototype as any).createSpan = function createSpan(options?: unknown) {
    return createChild.call(this, 'span', options as any);
  };
  (HTMLElement.prototype as any).createEl = function createEl(tag: string, options?: unknown) {
    return createChild.call(this, tag, options as any);
  };
  (HTMLElement.prototype as any).empty = function empty() {
    this.replaceChildren();
    return this;
  };
  (HTMLElement.prototype as any).setText = function setText(value: string) {
    this.textContent = value;
  };
  (HTMLElement.prototype as any).addClass = function addClass(value: string) {
    this.classList.add(value);
  };
  (HTMLElement.prototype as any).removeClass = function removeClass(value: string) {
    this.classList.remove(value);
  };
}

function createContext() {
  return {
    app: {
      workspace: { containerEl: document.body },
      vault: {
        getAbstractFileByPath: jest.fn(() => null),
        createFolder: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue(undefined),
      },
    } as any,
    component: {} as any,
  };
}

describe('LiveDocumentRenderer', () => {
  beforeAll(() => installObsidianDomHelpers());

  it('parses metadata and substantial markdown content', () => {
    const document = parseLiveDocument([
      '---',
      'title: Growth Strategy',
      'subtitle: Q3 operating plan',
      'author: Niccolo',
      'theme: business',
      'type: Strategy',
      '---',
      '# Growth Strategy',
      '',
      '## Executive summary',
      'A clear plan.',
    ].join('\n'));

    expect(document).toMatchObject({
      title: 'Growth Strategy',
      subtitle: 'Q3 operating plan',
      author: 'Niccolo',
      theme: 'business',
      documentType: 'Strategy',
    });
    expect(document?.body).toContain('## Executive summary');
  });

  it('supports four-backtick outer fences with nested code blocks', () => {
    const markdown = [
      '````claudian-document',
      '---',
      'title: API Guide',
      'theme: technical',
      '---',
      '# API Guide',
      '```ts',
      'const ready = true;',
      '```',
      '````',
    ].join('\n');

    const blocks = parseLiveDocumentBlocks(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].closed).toBe(true);
    expect(blocks[0].liveDocument?.body).toContain('```ts');
  });

  it('parses unfinished documents during streaming', () => {
    const blocks = parseLiveDocumentBlocks(
      '```claudian-document\n---\ntitle: Live Brief\n---\n# Live Brief\nFirst paragraph',
    );
    expect(blocks[0].closed).toBe(false);
    expect(blocks[0].liveDocument?.title).toBe('Live Brief');
  });

  it('renders a designed page with designer controls', async () => {
    const root = document.createElement('div');
    const liveDocument = parseLiveDocument('---\ntitle: Client Brief\ntheme: warm\n---\n# Client Brief\nContent')!;

    await renderLiveDocument(root, liveDocument, createContext());

    expect(root.querySelector('.claudian-live-document.theme-warm')).not.toBeNull();
    expect(root.querySelector('.claudian-live-document-masthead h1')?.textContent).toBe('Client Brief');
    expect(root.querySelectorAll('.claudian-live-document-action')).toHaveLength(4);
    expect(root.querySelector('.claudian-live-document-page')).not.toBeNull();

    (root.querySelector('.claudian-live-document-action') as HTMLButtonElement).click();
    expect(root.querySelector('.claudian-live-document.theme-technical')).not.toBeNull();
  });

  it('replaces a rendered document code fence with the live canvas', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code class="language-claudian-document">document</code></pre>';
    const markdown = '```claudian-document\n---\ntitle: Project Plan\n---\n# Project Plan\n## Scope\nText\n```';

    expect(await renderLiveDocuments(root, markdown, createContext())).toBe(true);
    expect(root.querySelector('pre')).toBeNull();
    expect(root.querySelector('.claudian-live-document')).not.toBeNull();
  });
});
