import { createMockEl } from '@test/helpers/mockElement';
import { TFile } from 'obsidian';

import type { LiveDocument } from '@/features/chat/rendering/LiveDocumentRenderer';
import { openLiveDocumentPreview } from '@/features/chat/rendering/LiveDocumentRenderer';
import { FilePreviewPanel } from '@/features/chat/ui/FilePreviewPanel';

jest.mock('@/features/chat/rendering/LiveDocumentRenderer', () => {
  const actual = jest.requireActual('@/features/chat/rendering/LiveDocumentRenderer');
  return { ...actual, openLiveDocumentPreview: jest.fn().mockResolvedValue(undefined) };
});

function vaultFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() ?? path;
  file.basename = file.name.replace(/\.[^.]+$/, '');
  file.extension = file.name.includes('.') ? (file.name.split('.').pop() ?? '') : '';
  return file;
}

function createPlugin(overrides: {
  activeFile?: TFile | null;
  files?: Record<string, TFile>;
  read?: (file: TFile) => Promise<string>;
  readBinary?: (file: TFile) => Promise<ArrayBuffer>;
  vaultFiles?: TFile[];
} = {}) {
  const files = overrides.files ?? {};
  const openFile = jest.fn().mockResolvedValue(undefined);
  return {
    app: {
      workspace: {
        getActiveFile: jest.fn(() => overrides.activeFile ?? null),
        containerEl: createMockEl(),
        getLeaf: jest.fn(() => ({ openFile })),
      },
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
        getFiles: jest.fn(() => overrides.vaultFiles ?? []),
        read: overrides.read ?? jest.fn(async (file: TFile) => `# ${file.name}`),
        readBinary: overrides.readBinary ?? jest.fn(async () => new ArrayBuffer(8)),
      },
    },
    openFile,
  };
}

function mountPanel(plugin = createPlugin()) {
  const container = createMockEl();
  const panel = new FilePreviewPanel(container as unknown as HTMLElement, plugin as any);
  panel.render();
  return { container, panel, plugin };
}

describe('FilePreviewPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens as an empty library instead of dumping the active vault note', async () => {
    const activeFile = vaultFile('Home.md');
    const { container, panel, plugin } = mountPanel(createPlugin({ activeFile }));

    panel.open();

    expect(plugin.app.workspace.getActiveFile).not.toHaveBeenCalled();
    expect(plugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('Bibliothek');
    expect(container.querySelector('.claudian-preview-empty')?.textContent).toContain('Erstellte Dokumente und Uploads');
    expect(container.querySelector('.claudian-preview-text')).toBeNull();
  });

  it('remembers an upload as a library card instead of looking the file up', () => {
    const { container, panel, plugin } = mountPanel();

    panel.rememberUpload({
      name: 'G175110768.pdf',
      relPath: '.claudian/attachments/G175110768.pdf',
    });

    expect(plugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(container.hasClass('claudian-preview-open')).toBe(false);
    panel.open();
    expect(container.querySelector('.claudian-preview-library')).not.toBeNull();
    expect(container.querySelector('.claudian-preview-card-name')?.textContent).toBe('G175110768.pdf');
    expect(container.querySelector('.claudian-preview-empty')).toBeNull();
  });

  it('does not open or store a resent image in the library', () => {
    const { container, panel } = mountPanel();

    panel.rememberUpload({
      name: 'shot.png',
      relPath: 'data:image/png;base64,abc',
      previewSrc: 'data:image/png;base64,abc',
    });
    panel.rememberUpload({
      name: 'photo.jpg',
      relPath: '.claudian/attachments/photo.jpg',
    });

    expect(container.hasClass('claudian-preview-open')).toBe(false);
    panel.open();
    expect(container.querySelector('.claudian-preview-empty')?.textContent).toContain('Erstellte Dokumente');
    expect(container.querySelector('.claudian-preview-card-name')).toBeNull();
  });

  it('silently remembers and updates a live document without duplicating it', () => {
    const { container, panel } = mountPanel();
    const document: LiveDocument = {
      title: 'Strategie Q3',
      theme: 'business',
      body: '# Strategie Q3\n\nPlan.',
    };

    panel.rememberLiveDocument(document);
    panel.rememberLiveDocument({ ...document, body: '# Strategie Q3\n\nAktualisierter Plan.' }, 'technical');
    panel.rememberLiveDocument(
      { ...document, body: '# Strategie Q3\n\nAktualisierter Plan aus dem Reload.' },
      'business',
      { preserveTheme: true },
    );

    expect(container.hasClass('claudian-preview-open')).toBe(false);
    panel.open();
    expect(container.querySelectorAll('.claudian-preview-card--live')).toHaveLength(1);
    expect(container.querySelector('.claudian-preview-card-name')?.textContent).toBe('Strategie Q3');
    expect(container.querySelector('.claudian-preview-card--live')).not.toBeNull();
    expect(container.querySelector('.claudian-preview-count')?.textContent).toBe('1');
    container.querySelector('.claudian-preview-card--live')?.click();
    expect(openLiveDocumentPreview).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('Plan aus dem Reload') }),
      'technical',
    );
  });

  it('renders an accessible toggle and restores focus when Escape closes the panel', () => {
    const { container } = mountPanel();
    const toggle = container.querySelector('.claudian-preview-toggle')!;
    const panelEl = container.querySelector('.claudian-preview-panel')!;
    const focusSpy = jest.spyOn(toggle, 'focus');

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panelEl.getAttribute('id'));

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    panelEl.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    expect(container.hasClass('claudian-preview-open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(focusSpy).toHaveBeenCalled();
  });

  it('uses modal semantics and traps focus inside the fullscreen mobile panel', () => {
    const plugin = createPlugin();
    const container = createMockEl();
    const mediaQuery = {
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    container.ownerDocument.defaultView.matchMedia = jest.fn(() => mediaQuery);
    let activeElement: any = null;
    Object.defineProperty(container.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => activeElement,
    });
    const panel = new FilePreviewPanel(container as unknown as HTMLElement, plugin as any);
    panel.render();
    panel.rememberLiveDocument({
      title: 'Mobil',
      theme: 'minimal',
      body: '# Mobil\nInhalt.',
    });

    const toggle = container.querySelector('.claudian-preview-toggle')!;
    const panelEl = container.querySelector('.claudian-preview-panel')!;
    const close = container.querySelector('.claudian-preview-close')!;
    const card = container.querySelector('.claudian-preview-card--live')!;
    panelEl.querySelectorAll = jest.fn(() => [close, card]);
    const toggleFocus = jest.spyOn(toggle, 'focus');
    const cardFocus = jest.spyOn(card, 'focus');
    activeElement = toggle;

    toggle.click();
    expect(panelEl.getAttribute('role')).toBe('dialog');
    expect(panelEl.getAttribute('aria-modal')).toBe('true');
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-hidden')).toBe('true');

    activeElement = close;
    const tabEvent = {
      type: 'keydown',
      key: 'Tab',
      shiftKey: true,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };
    panelEl.dispatchEvent(tabEvent);
    expect(tabEvent.preventDefault).toHaveBeenCalled();
    expect(cardFocus).toHaveBeenCalled();

    panel.close();
    expect(panelEl.getAttribute('role')).toBe('region');
    expect(panelEl.getAttribute('aria-modal')).toBeNull();
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-hidden')).toBeNull();
    expect(toggleFocus).toHaveBeenCalled();
  });

  it('opens a remembered live document from its focusable library card', () => {
    const { container, panel, plugin } = mountPanel();
    panel.rememberLiveDocument({
      title: 'Öffnen',
      theme: 'warm',
      body: '# Öffnen\n\nInhalt.',
    });
    panel.open();

    const card = container.querySelector('.claudian-preview-card--live')!;
    expect(card.tagName).toBe('BUTTON');
    expect(card.getAttribute('type')).toBe('button');
    card.click();

    expect(openLiveDocumentPreview).toHaveBeenCalledWith(
      plugin.app,
      expect.anything(),
      expect.objectContaining({ title: 'Öffnen' }),
      'warm',
    );
  });

  it('discovers saved vault documents and opens them through Obsidian', async () => {
    const saved = vaultFile('.claudian/documents/strategie-q3.md');
    const plugin = createPlugin({
      files: { [saved.path]: saved },
      vaultFiles: [saved, vaultFile('Notes/ignore.md')],
      read: jest.fn(async () => [
        '---',
        'document_id: "title:strategie-q3"',
        'title: Strategie Q3',
        'theme: business',
        '---',
        '# Strategie Q3',
        'Gespeichert.',
      ].join('\n')),
    });
    const { container, panel } = mountPanel(plugin);
    panel.rememberLiveDocument({
      title: 'Strategie Q3',
      theme: 'business',
      body: '# Strategie Q3\nEntwurf.',
    });

    await panel.refreshVaultDocuments();
    panel.open();
    const card = container.querySelector('.claudian-preview-card--vault')!;
    expect(card).not.toBeNull();
    expect(container.querySelectorAll('.claudian-preview-card--live')).toHaveLength(1);
    card.click();
    await Promise.resolve();

    expect(plugin.app.workspace.getLeaf).toHaveBeenCalledWith(false);
    expect(plugin.openFile).toHaveBeenCalledWith(saved);
  });

  it('does not keep a stale vault path on a later in-memory document update', async () => {
    const saved = vaultFile('.claudian/documents/strategie-q3.md');
    const plugin = createPlugin({
      files: { [saved.path]: saved },
      vaultFiles: [saved],
      read: jest.fn(async () => [
        '---',
        'document_id: "title:strategie-q3"',
        'title: Strategie Q3',
        'theme: business',
        '---',
        '# Strategie Q3',
        'Gespeicherter Stand.',
      ].join('\n')),
    });
    const { container, panel } = mountPanel(plugin);
    await panel.refreshVaultDocuments();

    panel.rememberLiveDocument({
      documentId: 'title:strategie-q3',
      title: 'Strategie Q3',
      theme: 'business',
      body: '# Strategie Q3\nAktualisierter Live-Stand.',
    }, 'technical', { preserveTheme: true });
    panel.open();

    const card = container.querySelector('.claudian-preview-card--live')!;
    expect(card.hasClass('claudian-preview-card--vault')).toBe(false);
    card.click();
    await Promise.resolve();

    expect(plugin.openFile).not.toHaveBeenCalled();
    expect(openLiveDocumentPreview).toHaveBeenCalledWith(
      plugin.app,
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('Aktualisierter Live-Stand') }),
      'business',
    );
  });
});

describe('FilePreviewPanel search', () => {
  function mountWithUploads() {
    const mounted = mountPanel();
    mounted.panel.rememberUpload({ name: 'Notiz.md', relPath: 'Inbox/Notiz.md' });
    mounted.panel.rememberUpload({ name: 'Budget 2026.xlsx', relPath: 'Finanzen/Budget 2026.xlsx' });
    mounted.panel.rememberUpload({ name: 'Vertrag.pdf', relPath: 'Kunden/CERTUSS/Vertrag.pdf' });
    mounted.panel.open();
    const input = mounted.container.querySelector('.claudian-preview-search-input')!;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent({ type: 'input', target: input });
    };
    const visibleNames = () => mounted.container.querySelectorAll('.claudian-preview-row')
      .filter((row: any) => !row.hasClass('claudian-hidden'))
      .map((row: any) => row.getAttribute('data-library-id'));
    return { ...mounted, input, type, visibleNames };
  }

  it('offers a labelled search field once the library has items', () => {
    const { container, panel } = mountPanel();
    const search = container.querySelector('.claudian-preview-search')!;
    expect(search.hasClass('claudian-hidden')).toBe(true);

    panel.rememberUpload({ name: 'Vertrag.pdf', relPath: 'Kunden/Vertrag.pdf' });

    expect(search.hasClass('claudian-hidden')).toBe(false);
    const input = container.querySelector('.claudian-preview-search-input')!;
    expect(input.getAttribute('aria-label')).toBe('Bibliothek durchsuchen');
    expect(input.getAttribute('type')).toBe('text');
  });

  it('filters by name, folder and German type words and reports "X von N"', () => {
    const { container, type, visibleNames } = mountWithUploads();

    type('tabelle');
    expect(visibleNames()).toEqual(['upload:Finanzen/Budget 2026.xlsx']);
    expect(container.querySelector('.claudian-preview-search-count')!.textContent).toBe('1 von 3');

    type('certuss');
    expect(visibleNames()).toEqual(['upload:Kunden/CERTUSS/Vertrag.pdf']);

    type('');
    expect(visibleNames()).toHaveLength(3);
    expect(container.querySelector('.claudian-preview-search-count')!.textContent).toBe('');
  });

  it('shows a German empty state whose reset action restores every row', () => {
    const { container, type, visibleNames } = mountWithUploads();

    type('rechnung');

    const noResults = container.querySelector('.claudian-preview-no-results')!;
    expect(noResults.hasClass('claudian-hidden')).toBe(false);
    expect(container.querySelector('.claudian-preview-no-results-title')!.textContent).toBe('Keine Treffer für „rechnung“');
    container.querySelector('.claudian-preview-no-results-reset')!.click();

    expect(noResults.hasClass('claudian-hidden')).toBe(true);
    expect(visibleNames()).toHaveLength(3);
  });

  it('clears an active search on Escape before Escape closes the panel', () => {
    const { container, input, type } = mountWithUploads();
    const panelEl = container.querySelector('.claudian-preview-panel')!;
    const escape = () => panelEl.dispatchEvent({
      type: 'keydown',
      key: 'Escape',
      target: input,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    });

    type('pdf');
    escape();
    expect(input.value).toBe('');
    expect(container.hasClass('claudian-preview-open')).toBe(true);

    escape();
    expect(container.hasClass('claudian-preview-open')).toBe(false);
  });

  it('moves through visible results with the arrow keys and opens with Enter', () => {
    const { container, input, type } = mountWithUploads();
    type('a');
    const rows = container.querySelectorAll('.claudian-preview-row')
      .filter((row: any) => !row.hasClass('claudian-hidden'))
      .map((row: any) => row.querySelector('.claudian-preview-row-open'));
    const firstFocus = jest.spyOn(rows[0], 'focus');
    const secondFocus = jest.spyOn(rows[1], 'focus');
    const inputFocus = jest.spyOn(input, 'focus');
    const key = (target: any, name: string) => {
      const event = { type: 'keydown', key: name, target, preventDefault: jest.fn(), stopPropagation: jest.fn() };
      target.dispatchEvent(event);
      container.querySelector('.claudian-preview-library')!.dispatchEvent(event);
      return event;
    };

    expect(key(input, 'ArrowDown').preventDefault).toHaveBeenCalled();
    expect(firstFocus).toHaveBeenCalled();
    key(rows[0], 'ArrowDown');
    expect(secondFocus).toHaveBeenCalled();
    key(rows[0], 'ArrowUp');
    expect(inputFocus).toHaveBeenCalled();

    const openSpy = jest.spyOn(rows[0], 'click');
    key(input, 'Enter');
    expect(openSpy).toHaveBeenCalled();
  });
});

// The library and the live-work overview share the chat's top-right corner.
// Where the drawer leaves no room, the overview steps back and the drawer
// says what is running instead.
describe('FilePreviewPanel live work', () => {
  function liveSource(initial: number) {
    let running = initial;
    const listeners = new Set<() => void>();
    return {
      source: {
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        runningCount: () => running,
      },
      set(value: number) {
        running = value;
        listeners.forEach(listener => listener());
      },
      listeners,
    };
  }

  it('names how many subagents are running', () => {
    const { container, panel } = mountPanel();
    const live = liveSource(2);

    panel.connectLiveWork(live.source, jest.fn());

    const chip = container.querySelector('.claudian-preview-live') as any;
    expect(chip.hasClass('claudian-hidden')).toBe(false);
    expect(chip.querySelector('.claudian-preview-live-label').textContent).toBe('2 Subagents aktiv');

    live.set(1);
    expect(chip.querySelector('.claudian-preview-live-label').textContent).toBe('1 Subagent aktiv');

    live.set(0);
    expect(chip.hasClass('claudian-hidden')).toBe(true);
  });

  it('closes the library and hands over to the live overview on click', () => {
    const { container, panel } = mountPanel();
    const onShow = jest.fn();
    panel.connectLiveWork(liveSource(1).source, onShow);
    panel.open();

    (container.querySelector('.claudian-preview-live') as any).click();

    expect(onShow).toHaveBeenCalled();
    expect(container.hasClass('claudian-preview-open')).toBe(false);
  });

  it('stops listening when the library is destroyed', () => {
    const { panel } = mountPanel();
    const live = liveSource(1);
    panel.connectLiveWork(live.source, jest.fn());

    panel.destroy();

    expect(live.listeners.size).toBe(0);
  });
});
