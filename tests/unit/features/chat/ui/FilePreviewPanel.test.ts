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
