/** @jest-environment jsdom */

import { MarkdownRenderer } from 'obsidian';

import {
  liveDocumentIdentity,
  openLiveDocumentPreview,
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

  it('uses a German fallback title when no title or heading exists', () => {
    expect(parseLiveDocument('Nur Inhalt.')?.title).toBe('Unbenanntes Dokument');
  });

  it('uses an explicit document id and otherwise a normalized title identity', () => {
    const explicit = parseLiveDocument('---\ntitle: Plan\ndocument_id: rollout-42\n---\n# Plan')!;
    const fallback = parseLiveDocument('---\ntitle:  STRATÉGIE   Q3 \n---\n# Strategie')!;

    expect(liveDocumentIdentity(explicit)).toBe('id:rollout-42');
    expect(liveDocumentIdentity(fallback)).toBe('title:strategie-q3');
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
    expect(root.querySelectorAll('.claudian-live-document-action')).toHaveLength(5);
    expect(root.querySelector('.claudian-live-document-page')).not.toBeNull();

    const themeButton = root.querySelector('.claudian-live-document-action') as HTMLButtonElement;
    themeButton.click();
    expect(root.querySelector('.claudian-live-document.theme-technical')).not.toBeNull();
    expect(themeButton.getAttribute('aria-label')).toBe('Design: Technisch');
  });

  it('docks the live document when the dock action is clicked', async () => {
    const root = document.createElement('div');
    const liveDocument = parseLiveDocument('---\ntitle: Dock Brief\ntheme: warm\n---\n# Dock Brief\nContent')!;
    const onDockDocument = jest.fn();

    await renderLiveDocument(root, liveDocument, { ...createContext(), onDockDocument });

    const dockButton = root.querySelector('[aria-label="Dokument andocken"]') as HTMLButtonElement;
    expect(dockButton).not.toBeNull();
    dockButton.click();
    expect(onDockDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Dock Brief' }),
      'warm',
    );
  });

  it('announces successful copying beyond the temporary icon change', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const root = document.createElement('div');
    const liveDocument = parseLiveDocument('---\ntitle: Kopie\n---\n# Kopie\nContent')!;

    await renderLiveDocument(root, liveDocument, createContext());
    const copyButton = root.querySelector('[aria-label="Dokument kopieren"]') as HTMLButtonElement;
    copyButton.click();
    await Promise.resolve();

    const announcement = root.querySelector('[role="status"]');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(announcement?.getAttribute('aria-live')).toBe('polite');
    expect(announcement?.textContent).toBe('Dokument wurde kopiert.');
    expect(copyButton.getAttribute('aria-label')).toBe('Dokument kopiert');
  });

  it('persists the same stable identity only after the explicit save action', async () => {
    const root = document.createElement('div');
    const context = createContext();
    const liveDocument = parseLiveDocument('---\ntitle: Strategie Q3\n---\n# Strategie Q3\nContent')!;
    await renderLiveDocument(root, liveDocument, context);

    (root.querySelector('[aria-label="Als Markdown im Vault speichern"]') as HTMLButtonElement).click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(context.app.vault.create).toHaveBeenCalledWith(
      expect.stringContaining('.claudian/documents/strategie-q3-'),
      expect.stringContaining('document_id: "title:strategie-q3"'),
    );
  });

  it('opens an accessible preview dialog and restores focus on Escape', async () => {
    const context = createContext();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const liveDocument = parseLiveDocument('---\ntitle: Dialog\n---\n# Dialog\nContent')!;

    await openLiveDocumentPreview(context.app, context.component, liveDocument, 'editorial');

    const overlay = document.querySelector('.claudian-live-document-overlay') as HTMLElement;
    const close = overlay.querySelector('[aria-label="Großansicht schließen"]') as HTMLButtonElement;
    expect(overlay.getAttribute('role')).toBe('dialog');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(close);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.claudian-live-document-overlay')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('installs preview dismissal before rendering finishes', async () => {
    let finishRendering!: () => void;
    (MarkdownRenderer.render as jest.Mock).mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishRendering = resolve;
    }));
    const context = createContext();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const liveDocument = parseLiveDocument('---\ntitle: Langsam\n---\n# Langsam\nContent')!;

    const previewPromise = openLiveDocumentPreview(context.app, context.component, liveDocument, 'editorial');
    const overlay = document.querySelector('.claudian-live-document-overlay') as HTMLElement;
    const close = overlay.querySelector('[aria-label="Großansicht schließen"]') as HTMLButtonElement;

    expect(document.activeElement).toBe(close);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.claudian-live-document-overlay')).toBeNull();
    expect(document.activeElement).toBe(opener);

    finishRendering();
    await expect(previewPromise).resolves.toBeUndefined();
  });

  it('keeps a failed preview closable and handles the render rejection', async () => {
    (MarkdownRenderer.render as jest.Mock).mockRejectedValueOnce(new Error('render failed'));
    const context = createContext();
    const liveDocument = parseLiveDocument('---\ntitle: Fehler\n---\n# Fehler\nContent')!;

    await expect(
      openLiveDocumentPreview(context.app, context.component, liveDocument, 'editorial'),
    ).resolves.toBeUndefined();

    const overlay = document.querySelector('.claudian-live-document-overlay') as HTMLElement;
    const close = overlay.querySelector('[aria-label="Großansicht schließen"]') as HTMLButtonElement;
    expect(overlay.querySelector('[role="alert"]')?.textContent).toContain('nicht dargestellt');
    expect(document.activeElement).toBe(close);

    close.click();
    expect(document.querySelector('.claudian-live-document-overlay')).toBeNull();
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
