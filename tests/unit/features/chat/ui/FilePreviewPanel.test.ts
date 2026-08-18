import { createMockEl } from '@test/helpers/mockElement';
import { MarkdownRenderer, TFile } from 'obsidian';

import type { LiveDocument } from '@/features/chat/rendering/LiveDocumentRenderer';
import { FilePreviewPanel } from '@/features/chat/ui/FilePreviewPanel';

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
} = {}) {
  const files = overrides.files ?? {};
  return {
    app: {
      workspace: {
        getActiveFile: jest.fn(() => overrides.activeFile ?? null),
      },
      vault: {
        getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
        read: overrides.read ?? jest.fn(async (file: TFile) => `# ${file.name}`),
        readBinary: overrides.readBinary ?? jest.fn(async () => new ArrayBuffer(8)),
      },
    },
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

  it('opens with an empty dock state instead of dumping the active vault note', async () => {
    const activeFile = vaultFile('Home.md');
    const { container, panel, plugin } = mountPanel(createPlugin({ activeFile }));

    panel.open();

    expect(plugin.app.workspace.getActiveFile).not.toHaveBeenCalled();
    expect(plugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('Dokument');
    expect(container.querySelector('.claudian-preview-empty')?.textContent).toContain('Noch kein Dokument angedockt');
    expect(container.querySelector('.claudian-preview-text')).toBeNull();
  });

  it('docks a vault file and renders markdown as a page, not raw source', async () => {
    const file = vaultFile('.claudian/documents/brief.md');
    const { container, panel } = mountPanel(createPlugin({
      files: { [file.path]: file },
      read: jest.fn(async () => '# Brief\n\nHallo Welt'),
    }));

    await panel.dockFile(file.path);

    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('brief.md');
    expect(container.querySelector('.claudian-preview-page')).not.toBeNull();
    expect(container.querySelector('.claudian-preview-text--markdown')).toBeNull();
    expect(MarkdownRenderer.render).toHaveBeenCalled();
  });

  it('docks a live document into the panel', async () => {
    const { container, panel } = mountPanel();
    const document: LiveDocument = {
      title: 'Strategie Q3',
      theme: 'business',
      body: '# Strategie Q3\n\nPlan.',
    };

    await panel.dockLiveDocument(document);

    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('Strategie Q3');
    expect(container.querySelector('.claudian-preview-live')).not.toBeNull();
  });

  it('docks a PDF with an embedded preview', async () => {
    const file = vaultFile('.claudian/attachments/vertrag.pdf');
    const { container, panel } = mountPanel(createPlugin({
      files: { [file.path]: file },
    }));

    await panel.dockFile(file.path);

    expect(container.querySelector('.claudian-preview-pdf')).not.toBeNull();
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('vertrag.pdf');
  });
});
