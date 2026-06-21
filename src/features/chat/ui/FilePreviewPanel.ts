import { setIcon, TFile } from 'obsidian';

import type ClaudianPlugin from '../../../main';

/**
 * Collapsible file preview panel that slides in from the right side of the chat.
 * Shows live previews of the current note, attached files, or created documents.
 * Supports PDF (iframe), images (img), code/text (pre), and CSV (table).
 */
export class FilePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private isOpen = false;
  private currentFilePath: string | null = null;
  /** Object URL of the currently previewed blob (PDF/image), revoked on replace/destroy. */
  private activeObjectUrl: string | null = null;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly plugin: ClaudianPlugin,
  ) {}

  /** Creates the toggle button and panel shell. Call once during chat init. */
  render(): void {
    // Toggle button — top-right of chat area
    this.toggleBtn = this.containerEl.createDiv({ cls: 'claudian-preview-toggle' });
    setIcon(this.toggleBtn, 'panel-right');
    this.toggleBtn.setAttribute('aria-label', 'Toggle file preview panel');
    this.toggleBtn.addEventListener('click', () => this.toggle());

    // Panel — slides in from the right
    this.panelEl = this.containerEl.createDiv({ cls: 'claudian-preview-panel' });
    this.panelEl.style.display = 'none';

    const header = this.panelEl.createDiv({ cls: 'claudian-preview-header' });
    setIcon(header.createSpan({ cls: 'claudian-preview-header-icon' }), 'file-text');
    header.createEl('span', { cls: 'claudian-preview-title', text: 'Preview' });
    const closeBtn = header.createEl('button', { cls: 'claudian-preview-close' });
    setIcon(closeBtn, 'x');
    closeBtn.addEventListener('click', () => this.close());

    this.contentEl = this.panelEl.createDiv({ cls: 'claudian-preview-content' });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.panelEl) return;
    this.isOpen = true;
    this.panelEl.style.display = 'flex';
    this.containerEl.addClass('claudian-preview-open');
    this.toggleBtn?.addClass('claudian-preview-toggle--active');
    // Auto-preview the current note if nothing is loaded
    if (!this.currentFilePath) {
      this.previewCurrentNote();
    }
  }

  close(): void {
    if (!this.panelEl) return;
    this.isOpen = false;
    this.panelEl.style.display = 'none';
    this.containerEl.removeClass('claudian-preview-open');
    this.toggleBtn?.removeClass('claudian-preview-toggle--active');
  }

  /** Previews a specific vault file by path. */
  async previewFile(filePath: string): Promise<void> {
    if (!this.contentEl) return;
    this.currentFilePath = filePath;
    this.contentEl.empty();
    this.revokeActiveObjectUrl();

    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: `File not found: ${filePath}` });
      return;
    }

    const ext = file.extension.toLowerCase();
    const loadingEl = this.contentEl.createEl('p', { cls: 'claudian-preview-loading', text: 'Loading...' });

    try {
      switch (ext) {
        case 'pdf':
          await this.renderPdfPreview(file);
          break;
        case 'png':
        case 'jpg':
        case 'jpeg':
        case 'gif':
        case 'webp':
        case 'svg':
        case 'bmp':
          await this.renderImagePreview(file);
          break;
        case 'csv':
          await this.renderCsvPreview(file);
          break;
        case 'md':
        case 'markdown':
          await this.renderTextPreview(file, 'markdown');
          break;
        default:
          if (this.isCodeFile(ext)) {
            await this.renderTextPreview(file, 'code');
          } else {
            await this.renderTextPreview(file, 'text');
          }
      }
      loadingEl.remove();
    } catch (error) {
      loadingEl.remove();
      this.contentEl.createEl('p', {
        cls: 'claudian-preview-error',
        text: `Preview failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /** Auto-detects and previews the current active note. */
  previewCurrentNote(): void {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile) {
      void this.previewFile(activeFile.path);
    } else if (this.contentEl) {
      this.contentEl.empty();
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: 'No file open. Click a file link in the chat to preview it.' });
    }
  }

  /** Previews content from a data URI (e.g., generated artifacts, inline images). */
  previewDataUri(dataUri: string, mimeType: string, fileName: string): void {
    if (!this.contentEl) return;
    this.contentEl.empty();
    this.revokeActiveObjectUrl();
    this.currentFilePath = fileName;

    if (mimeType.startsWith('image/')) {
      const img = this.contentEl.createEl('img', { cls: 'claudian-preview-image' });
      img.src = dataUri;
    } else if (mimeType === 'text/html') {
      const iframe = this.contentEl.createEl('iframe', { cls: 'claudian-preview-iframe' });
      iframe.src = dataUri;
      iframe.setAttribute('sandbox', 'allow-scripts');
    } else {
      this.contentEl.createEl('pre', { cls: 'claudian-preview-text', text: fileName });
    }
  }

  private async renderPdfPreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    // Read the PDF as binary and create a blob URL for iframe embedding
    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    this.activeObjectUrl = url;
    const iframe = this.contentEl.createEl('iframe', { cls: 'claudian-preview-pdf' });
    iframe.src = url;
    iframe.setAttribute('sandbox', 'allow-same-origin');
    // The URL is revoked on the next preview / panel destroy (revokeActiveObjectUrl).
  }

  private async renderImagePreview(file: TFile): Promise<void> {
    if (!this.contentEl) return;
    const arrayBuffer = await this.plugin.app.vault.readBinary(file);
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    this.activeObjectUrl = url;
    const img = this.contentEl.createEl('img', { cls: 'claudian-preview-image' });
    img.src = url;
    img.alt = file.name;
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
    const rows = this.parseCsv(content);
    if (rows.length === 0) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: 'Empty CSV file.' });
      return;
    }

    const wrap = this.contentEl.createDiv({ cls: 'claudian-preview-table-wrap' });
    const table = wrap.createEl('table', { cls: 'claudian-preview-table' });
    // Header
    const thead = table.createEl('thead');
    const headerRow = thead.createEl('tr');
    for (const cell of rows[0]) {
      headerRow.createEl('th', { text: cell });
    }
    // Body (limit to 100 rows for performance)
    const tbody = table.createEl('tbody');
    for (const row of rows.slice(1, 101)) {
      const tr = tbody.createEl('tr');
      for (const cell of row) {
        tr.createEl('td', { text: cell });
      }
    }
    if (rows.length > 101) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-truncated', text: `Showing 100 of ${rows.length - 1} rows.` });
    }
  }

  private async renderTextPreview(file: TFile, kind: 'text' | 'code' | 'markdown'): Promise<void> {
    if (!this.contentEl) return;
    const content = await this.plugin.app.vault.read(file);
    const pre = this.contentEl.createEl('pre', { cls: `claudian-preview-text claudian-preview-text--${kind}` });
    const code = pre.createEl('code', { text: content.slice(0, 50_000) });
    if (kind === 'code') {
      code.addClass('language-' + file.extension);
    }
    if (content.length > 50_000) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-truncated', text: `Truncated (showing first 50K chars of ${content.length.toLocaleString()}).` });
    }
  }

  private parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      // Simple CSV parser — handles quoted fields
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

  private isCodeFile(ext: string): boolean {
    const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'rb', 'php', 'c', 'cpp', 'h', 'sh', 'yml', 'yaml', 'json', 'xml', 'html', 'css', 'sql', 'toml', 'ini', 'env'];
    return codeExts.includes(ext);
  }

  destroy(): void {
    this.close();
    this.revokeActiveObjectUrl();
    this.panelEl?.remove();
    this.toggleBtn?.remove();
    this.panelEl = null;
    this.toggleBtn = null;
    this.contentEl = null;
  }
}
