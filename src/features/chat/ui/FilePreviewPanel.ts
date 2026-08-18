import { Component, setIcon } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import type { LiveDocument, LiveDocumentTheme } from '../rendering/LiveDocumentRenderer';
import {
  attachmentKindLabel,
  attachmentPeekMode,
  attachmentTypeMeta,
} from './file-drop/attachmentMeta';

const EMPTY_COPY = 'Erstellte Dokumente und Uploads erscheinen hier.';

export interface LibraryUpload {
  name: string;
  relPath: string;
  previewSrc?: string;
}

type LibraryItem =
  | { id: string; type: 'upload'; name: string; relPath: string; previewSrc?: string }
  | { id: string; type: 'live'; liveDocument: LiveDocument; theme: LiveDocumentTheme };

/**
 * Right-side library of created documents and uploaded files.
 * This is a history, not a vault-file loader — it never dumps the active note.
 */
export class FilePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private isOpen = false;
  private readonly host = new Component();
  private readonly items: LibraryItem[] = [];

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly plugin: ClaudianPlugin,
  ) {}

  render(): void {
    this.host.load();
    this.toggleBtn = this.containerEl.createDiv({ cls: 'claudian-preview-toggle' });
    setIcon(this.toggleBtn, 'panel-right');
    this.toggleBtn.setAttribute('aria-label', 'Speicher öffnen');
    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.panelEl = this.containerEl.createDiv({ cls: 'claudian-preview-panel' });

    const header = this.panelEl.createDiv({ cls: 'claudian-preview-header' });
    setIcon(header.createSpan({ cls: 'claudian-preview-header-icon' }), 'images');
    this.titleEl = header.createEl('span', { cls: 'claudian-preview-title', text: 'Speicher' });
    const closeBtn = header.createEl('button', { cls: 'claudian-preview-close' });
    setIcon(closeBtn, 'x');
    closeBtn.setAttribute('aria-label', 'Speicher schließen');
    closeBtn.addEventListener('click', () => this.close());

    this.contentEl = this.panelEl.createDiv({ cls: 'claudian-preview-content' });
    this.renderLibrary();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.panelEl) return;
    this.isOpen = true;
    this.panelEl.addClass('is-open');
    this.containerEl.addClass('claudian-preview-open');
    this.toggleBtn?.addClass('claudian-preview-toggle--active');
    this.toggleBtn?.setAttribute('aria-label', 'Speicher schließen');
    this.renderLibrary();
  }

  close(): void {
    if (!this.panelEl) return;
    this.isOpen = false;
    this.panelEl.removeClass('is-open');
    this.containerEl.removeClass('claudian-preview-open');
    this.toggleBtn?.removeClass('claudian-preview-toggle--active');
    this.toggleBtn?.setAttribute('aria-label', 'Speicher öffnen');
  }

  rememberUpload(upload: LibraryUpload): void {
    if (this.items.some((item) => item.type === 'upload' && item.relPath === upload.relPath)) {
      this.open();
      return;
    }
    this.items.unshift({
      id: `upload:${upload.relPath}`,
      type: 'upload',
      name: upload.name,
      relPath: upload.relPath,
      previewSrc: upload.previewSrc,
    });
    this.open();
  }

  rememberLiveDocument(document: LiveDocument, theme?: LiveDocumentTheme): void {
    const id = `live:${document.title}`;
    this.items.unshift({
      id,
      type: 'live',
      liveDocument: document,
      theme: theme ?? document.theme,
    });
    this.open();
  }

  /** @deprecated Use rememberUpload — the pane is a library, not a file loader. */
  async dockFile(filePath: string): Promise<void> {
    const name = filePath.split('/').pop() ?? filePath;
    this.rememberUpload({ name, relPath: filePath });
  }

  async dockLiveDocument(document: LiveDocument, theme?: LiveDocumentTheme): Promise<void> {
    this.rememberLiveDocument(document, theme);
  }

  private renderLibrary(): void {
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.setTitle('Speicher');

    if (this.items.length === 0) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: EMPTY_COPY });
      return;
    }

    const library = this.contentEl.createDiv({ cls: 'claudian-preview-library' });
    for (const item of this.items) {
      this.renderCard(library, item);
    }
  }

  private renderCard(parent: HTMLElement, item: LibraryItem): void {
    if (item.type === 'live') {
      const card = parent.createDiv({ cls: 'claudian-preview-card claudian-preview-card--live' });
      const peek = card.createDiv({ cls: 'claudian-preview-card-peek' });
      peek.createSpan({ cls: 'claudian-preview-card-live-label', text: 'Live' });
      peek.createEl('strong', { text: item.liveDocument.title });
      card.createSpan({ cls: 'claudian-preview-card-name', text: item.liveDocument.title });
      return;
    }

    const meta = attachmentTypeMeta(item.name);
    const peekMode = attachmentPeekMode(item.name);
    const card = parent.createDiv({
      cls: `claudian-preview-card claudian-preview-card--${meta.kind}`,
    });
    const peek = card.createDiv({ cls: 'claudian-preview-card-peek' });
    const resourcePath = item.previewSrc ?? this.resolveResourcePath(item.relPath);

    if (peekMode === 'iframe' && resourcePath) {
      const iframe = peek.createEl('iframe', {
        cls: 'claudian-preview-card-pdf',
        attr: { src: resourcePath, sandbox: 'allow-same-origin', tabindex: '-1', title: item.name },
      });
      iframe.addClass('claudian-preview-card-pdf');
    } else if (peekMode === 'thumb' && resourcePath) {
      peek.createEl('img', {
        cls: 'claudian-preview-card-image',
        attr: { src: resourcePath, alt: item.name },
      });
    } else {
      setIcon(peek.createSpan({ cls: 'claudian-preview-card-icon' }), meta.icon);
      peek.createSpan({ cls: 'claudian-preview-card-kind', text: attachmentKindLabel(meta.kind) });
    }

    card.createSpan({ cls: 'claudian-preview-card-name', text: item.name });
  }

  private resolveResourcePath(relPath: string): string | null {
    try {
      return this.plugin.app.vault.adapter.getResourcePath(relPath);
    } catch {
      return null;
    }
  }

  private setTitle(title: string): void {
    this.titleEl?.setText(title);
  }

  destroy(): void {
    this.close();
    this.host.unload();
    this.panelEl?.remove();
    this.toggleBtn?.remove();
    this.panelEl = null;
    this.toggleBtn = null;
    this.contentEl = null;
    this.titleEl = null;
  }
}
