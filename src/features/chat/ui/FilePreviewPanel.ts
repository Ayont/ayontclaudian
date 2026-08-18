import { Component, MarkdownRenderer, setIcon, TFile } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import type { LiveDocument, LiveDocumentTheme } from '../rendering/LiveDocumentRenderer';
import {
  attachmentKindLabel,
  attachmentPeekMode,
  attachmentTypeMeta,
} from './file-drop/attachmentMeta';

const EMPTY_COPY = 'Noch kein Dokument angedockt. Zieh eine Datei in den Chat oder klicke auf ein Dokument, um es hier zu öffnen.';

/**
 * Right-side dock for created live documents and dropped files.
 * Never dumps the active vault note — the pane only shows something the
 * user (or the agent) explicitly docked.
 */
export class FilePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private isOpen = false;
  private currentFilePath: string | null = null;
  private readonly host = new Component();
  /** Object URL of the currently previewed blob (PDF/image), revoked on replace/destroy. */
  private activeObjectUrl: string | null = null;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly plugin: ClaudianPlugin,
  ) {}

  /** Creates the toggle button and panel shell. Call once during chat init. */
  render(): void {
    this.host.load();
    this.toggleBtn = this.containerEl.createDiv({ cls: 'claudian-preview-toggle' });
    setIcon(this.toggleBtn, 'panel-right');
    this.toggleBtn.setAttribute('aria-label', 'Dokument andocken');
    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.panelEl = this.containerEl.createDiv({ cls: 'claudian-preview-panel' });

    const header = this.panelEl.createDiv({ cls: 'claudian-preview-header' });
    setIcon(header.createSpan({ cls: 'claudian-preview-header-icon' }), 'file-text');
    this.titleEl = header.createEl('span', { cls: 'claudian-preview-title', text: 'Dokument' });
    const closeBtn = header.createEl('button', { cls: 'claudian-preview-close' });
    setIcon(closeBtn, 'x');
    closeBtn.setAttribute('aria-label', 'Dokument schließen');
    closeBtn.addEventListener('click', () => this.close());

    this.contentEl = this.panelEl.createDiv({ cls: 'claudian-preview-content' });
    this.renderEmptyState();
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
    this.toggleBtn?.setAttribute('aria-label', 'Dokument schließen');
    if (!this.currentFilePath) {
      this.renderEmptyState();
    }
  }

  close(): void {
    if (!this.panelEl) return;
    this.isOpen = false;
    this.panelEl.removeClass('is-open');
    this.containerEl.removeClass('claudian-preview-open');
    this.toggleBtn?.removeClass('claudian-preview-toggle--active');
    this.toggleBtn?.setAttribute('aria-label', 'Dokument andocken');
  }

  /** Opens the pane and docks a vault file. */
  async dockFile(filePath: string): Promise<void> {
    this.open();
    await this.previewFile(filePath);
  }

  /** Opens the pane and docks a created live document. */
  async dockLiveDocument(document: LiveDocument, theme?: LiveDocumentTheme): Promise<void> {
    if (!this.contentEl) return;
    this.open();
    this.currentFilePath = `live:${document.title}`;
    this.setTitle(document.title);
    this.contentEl.empty();
    this.revokeActiveObjectUrl();

    const activeTheme = theme ?? document.theme;
    const wrap = this.contentEl.createDiv({
      cls: `claudian-preview-live claudian-live-document theme-${activeTheme}`,
    });
    const page = wrap.createDiv({ cls: 'claudian-preview-page claudian-live-document-page' });
    this.renderDocumentMasthead(page, document);
    const body = page.createDiv({ cls: 'claudian-live-document-body' });
    await MarkdownRenderer.render(this.plugin.app, document.body, body, '', this.host);
  }

  /** Previews a specific vault file by path. */
  async previewFile(filePath: string): Promise<void> {
    if (!this.contentEl) return;
    this.currentFilePath = filePath;
    this.contentEl.empty();
    this.revokeActiveObjectUrl();

    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      this.contentEl.createEl('p', {
        cls: 'claudian-preview-empty',
        text: `Datei nicht gefunden: ${filePath}`,
      });
      return;
    }

    this.setTitle(file.name);
    const ext = file.extension.toLowerCase();
    const loadingEl = this.contentEl.createEl('p', { cls: 'claudian-preview-loading', text: 'Wird geladen…' });
    const peek = attachmentPeekMode(file.name);

    try {
      if (peek === 'iframe' || ext === 'pdf') {
        await this.renderPdfPreview(file);
      } else if (peek === 'thumb') {
        await this.renderImagePreview(file);
      } else if (peek === 'media') {
        await this.renderMediaPreview(file);
      } else if (peek === 'table') {
        await this.renderCsvPreview(file);
      } else if (peek === 'page' || ext === 'md' || ext === 'markdown') {
        await this.renderMarkdownPage(file);
      } else if (peek === 'code') {
        await this.renderTextPreview(file, 'code');
      } else {
        this.renderPaperPreview(file.name);
      }
      loadingEl.remove();
    } catch (error) {
      loadingEl.remove();
      this.contentEl.createEl('p', {
        cls: 'claudian-preview-error',
        text: `Vorschau fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /** Previews content from a data URI (e.g., generated artifacts, inline images). */
  previewDataUri(dataUri: string, mimeType: string, fileName: string): void {
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.revokeActiveObjectUrl();
    this.currentFilePath = fileName;
    this.setTitle(fileName);

    if (mimeType.startsWith('image/')) {
      const img = this.contentEl.createEl('img', { cls: 'claudian-preview-image' });
      img.src = dataUri;
    } else if (mimeType === 'text/html') {
      const iframe = this.contentEl.createEl('iframe', { cls: 'claudian-preview-iframe' });
      iframe.src = dataUri;
      iframe.setAttribute('sandbox', 'allow-scripts');
    } else {
      this.renderPaperPreview(fileName);
    }
  }

  private renderEmptyState(): void {
    if (!this.contentEl || this.currentFilePath) return;
    this.contentEl.empty();
    this.setTitle('Dokument');
    this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: EMPTY_COPY });
  }

  private setTitle(title: string): void {
    this.titleEl?.setText(title);
  }

  private renderDocumentMasthead(page: HTMLElement, document: LiveDocument): void {
    const masthead = page.createDiv({ cls: 'claudian-live-document-masthead' });
    if (document.documentType) {
      masthead.createSpan({ cls: 'claudian-live-document-type', text: document.documentType });
    }
    masthead.createEl('h1', { text: document.title });
    if (document.subtitle) {
      masthead.createEl('p', { cls: 'claudian-live-document-subtitle', text: document.subtitle });
    }
    if (document.author || document.date) {
      const byline = masthead.createDiv({ cls: 'claudian-live-document-byline' });
      if (document.author) byline.createSpan({ text: document.author });
      if (document.author && document.date) byline.createSpan({ text: '·' });
      if (document.date) byline.createSpan({ text: document.date });
    }
  }

  private async renderMarkdownPage(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const content = await this.plugin.app.vault.read(file);
    const page = this.contentEl.createDiv({ cls: 'claudian-preview-page' });
    await MarkdownRenderer.render(this.plugin.app, content, page, file.path, this.host);
  }

  private resolveResourcePath(file: TFile): string | null {
    try {
      return this.plugin.app.vault.adapter.getResourcePath(file.path);
    } catch {
      return null;
    }
  }

  private async createObjectUrl(file: TFile, mimeType?: string): Promise<string | null> {
    const fromAdapter = this.resolveResourcePath(file);
    if (fromAdapter) return fromAdapter;
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const blob = mimeType ? new Blob([arrayBuffer], { type: mimeType }) : new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    this.activeObjectUrl = url;
    return url;
  }

  private async renderPdfPreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const url = await this.createObjectUrl(file, 'application/pdf');
    const iframe = this.contentEl.createEl('iframe', { cls: 'claudian-preview-pdf' });
    if (url) iframe.src = url;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    iframe.setAttribute('title', file.name);
  }

  private async renderImagePreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const url = await this.createObjectUrl(file);
    const img = this.contentEl.createEl('img', { cls: 'claudian-preview-image' });
    if (url) img.src = url;
    img.alt = file.name;
  }

  private async renderMediaPreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const meta = attachmentTypeMeta(file.name);
    const url = await this.createObjectUrl(file);
    const media = this.contentEl.createEl(meta.kind === 'audio' ? 'audio' : 'video', {
      cls: 'claudian-preview-media',
      attr: { controls: 'true', preload: 'metadata' },
    });
    if (url) media.src = url;
  }

  private renderPaperPreview(fileName: string): void {
    if (!this.contentEl) return;
    const meta = attachmentTypeMeta(fileName);
    const paper = this.contentEl.createDiv({
      cls: `claudian-preview-paper claudian-preview-paper--${meta.kind}`,
    });
    const stack = paper.createDiv({ cls: 'claudian-preview-paper-stack' });
    stack.createDiv({ cls: 'claudian-preview-paper-sheet' });
    stack.createDiv({ cls: 'claudian-preview-paper-sheet' });
    const face = stack.createDiv({ cls: 'claudian-preview-paper-face' });
    setIcon(face.createSpan({ cls: 'claudian-preview-paper-icon' }), meta.icon);
    face.createSpan({ cls: 'claudian-preview-paper-kind', text: attachmentKindLabel(meta.kind) });
    face.createEl('strong', { cls: 'claudian-preview-paper-name', text: fileName });
    paper.createEl('p', {
      cls: 'claudian-preview-paper-hint',
      text: 'Dieses Format wird als Dokumentkarte angezeigt. Zum Bearbeiten in der Standard-App öffnen.',
    });
  }

  /** Releases the active blob URL so previewed binaries don't pin memory. */
  private revokeActiveObjectUrl(): void {
    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }
  }

  private async renderCsvPreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const content = await this.plugin.app.vault.read(file);
    const rows = parseCsv(content);
    if (rows.length === 0) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: 'Leere CSV-Datei.' });
      return;
    }

    const wrap = this.contentEl.createDiv({ cls: 'claudian-preview-table-wrap' });
    const table = wrap.createEl('table', { cls: 'claudian-preview-table' });
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    for (const cell of rows[0]) {
      headerRow.createEl('th', { text: cell });
    }
    const tbody = table.createEl('tbody');
    for (const row of rows.slice(1, 101)) {
      const tr = tbody.createEl('tr');
      for (const cell of row) {
        tr.createEl('td', { text: cell });
      }
    }
    if (rows.length > 101) {
      this.contentEl.createEl('p', {
        cls: 'claudian-preview-truncated',
        text: `Zeige 100 von ${rows.length - 1} Zeilen.`,
      });
    }
  }

  private async renderTextPreview(file: TFile, kind: 'text' | 'code'): Promise<void> {
    if (!this.contentEl) return;
    const content = await this.plugin.app.vault.read(file);
    const pre = this.contentEl.createEl('pre', { cls: `claudian-preview-text claudian-preview-text--${kind}` });
    const code = pre.createEl('code', { text: content.slice(0, 50_000) });
    if (kind === 'code') {
      code.addClass('language-' + file.extension);
    }
    if (content.length > 50_000) {
      this.contentEl.createEl('p', {
        cls: 'claudian-preview-truncated',
        text: `Gekürzt (erste 50.000 Zeichen von ${content.length.toLocaleString('de-DE')}).`,
      });
    }
  }

  destroy(): void {
    this.close();
    this.host.unload();
    this.revokeActiveObjectUrl();
    this.panelEl?.remove();
    this.toggleBtn?.remove();
    this.panelEl = null;
    this.toggleBtn = null;
    this.contentEl = null;
    this.titleEl = null;
  }
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    rows.push(cells);
  }
  return rows;
}
