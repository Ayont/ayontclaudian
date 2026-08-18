import { createMockEl } from '@test/helpers/mockElement';
import { TFile } from 'obsidian';

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

  it('opens as an empty library instead of dumping the active vault note', async () => {
    const activeFile = vaultFile('Home.md');
    const { container, panel, plugin } = mountPanel(createPlugin({ activeFile }));

    panel.open();

    expect(plugin.app.workspace.getActiveFile).not.toHaveBeenCalled();
    expect(plugin.app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-title')?.textContent).toBe('Speicher');
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
    expect(container.hasClass('claudian-preview-open')).toBe(true);
    expect(container.querySelector('.claudian-preview-library')).not.toBeNull();
    expect(container.querySelector('.claudian-preview-card-name')?.textContent).toBe('G175110768.pdf');
    expect(container.querySelector('.claudian-preview-empty')).toBeNull();
  });

  it('keeps created live documents in the same library', () => {
    const { container, panel } = mountPanel();
    const document: LiveDocument = {
      title: 'Strategie Q3',
      theme: 'business',
      body: '# Strategie Q3\n\nPlan.',
    };

    panel.rememberLiveDocument(document);

    expect(container.querySelector('.claudian-preview-card-name')?.textContent).toBe('Strategie Q3');
    expect(container.querySelector('.claudian-preview-card--live')).not.toBeNull();
  });
});
