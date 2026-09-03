import { Component, Notice, setIcon, TFile } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import { getFileManagerName, openInDefaultApp, revealInSystemFileManager, showFileContextMenu } from '../services/FileActionService';
import { createPdfPeekSrcFromPath } from './file-drop/pdfPeek';
import {
  type LiveDocument,
  liveDocumentIdentity,
  type LiveDocumentTheme,
  openLiveDocumentPreview,
  parseLiveDocument,
} from '../rendering/LiveDocumentRenderer';
import {
  attachmentKindLabel,
  attachmentPeekMode,
  attachmentTypeMeta,
} from './file-drop/attachmentMeta';

const EMPTY_COPY = 'Erstellte Dokumente und Uploads erscheinen hier.';
const DOCUMENT_FOLDER_PREFIX = '.claudian/documents/';
const FULLSCREEN_MEDIA_QUERY = '(max-width: 768px)';
let nextPanelId = 1;

function isChatImageUpload(upload: LibraryUpload): boolean {
  if (upload.relPath.startsWith('data:image')) return true;
  return attachmentTypeMeta(upload.name).kind === 'image';
}

function documentExcerpt(document: LiveDocument): string {
  return document.body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~>]/g, '')
    .replace(/\[|\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export interface LibraryUpload {
  name: string;
  relPath: string;
  previewSrc?: string;
}

type LibraryItem =
  | { id: string; type: 'upload'; name: string; relPath: string; previewSrc?: string }
  | {
    id: string;
    type: 'live';
    liveDocument: LiveDocument;
    theme: LiveDocumentTheme;
    vaultPath?: string;
  };

/** Persistent, non-destructive library of generated documents and uploads. */
export class FilePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private titleEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private isOpen = false;
  private isFullscreen = false;
  private destroyed = false;
  private previouslyFocused: HTMLElement | null = null;
  private fullscreenQuery: MediaQueryList | null = null;
  private refreshPromise: Promise<void> | null = null;
  private readonly host = new Component();
  private readonly items: LibraryItem[] = [];
  private readonly panelId = `claudian-document-library-${nextPanelId++}`;

  constructor(
    private readonly containerEl: HTMLElement,
    private readonly plugin: ClaudianPlugin,
  ) {}

  render(): void {
    this.host.load();
    this.toggleBtn = this.containerEl.createEl('button', {
      cls: 'claudian-preview-toggle clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Dokumentbibliothek öffnen',
        'aria-expanded': 'false',
        'aria-controls': this.panelId,
      },
    });
    setIcon(this.toggleBtn, 'library');
    this.toggleBtn.addEventListener('click', () => this.toggle());

    this.panelEl = this.containerEl.createDiv({ cls: 'claudian-preview-panel' });
    this.panelEl.setAttribute('id', this.panelId);
    this.panelEl.setAttribute('role', 'region');
    this.panelEl.setAttribute('aria-label', 'Dokumentbibliothek');
    this.panelEl.setAttribute('tabindex', '-1');
    this.panelEl.addEventListener('keydown', this.handlePanelKeydown);

    const header = this.panelEl.createDiv({ cls: 'claudian-preview-header' });
    const brand = header.createDiv({ cls: 'claudian-preview-brand' });
    setIcon(brand.createSpan({ cls: 'claudian-preview-header-icon' }), 'library');
    const titles = brand.createDiv({ cls: 'claudian-preview-titles' });
    this.titleEl = titles.createEl('span', { cls: 'claudian-preview-title', text: 'Bibliothek' });
    titles.createEl('span', { cls: 'claudian-preview-subtitle', text: 'Dokumente & Uploads' });
    this.countEl = header.createSpan({ cls: 'claudian-preview-count claudian-hidden', text: '0' });
    this.closeBtn = header.createEl('button', {
      cls: 'claudian-preview-close clickable-icon',
      attr: { type: 'button', 'aria-label': 'Dokumentbibliothek schließen' },
    });
    setIcon(this.closeBtn, 'x');
    this.closeBtn.addEventListener('click', () => this.close());

    this.contentEl = this.panelEl.createDiv({ cls: 'claudian-preview-content' });
    this.configureFullscreenMode();
    this.renderLibrary();
    void this.refreshVaultDocuments();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (!this.panelEl) return;
    const opening = !this.isOpen;
    if (opening) {
      const activeElement = this.containerEl.ownerDocument?.activeElement as HTMLElement | null;
      this.previouslyFocused = activeElement && typeof activeElement.focus === 'function'
        ? activeElement
        : null;
    }
    this.isOpen = true;
    this.panelEl.addClass('is-open');
    this.containerEl.addClass('claudian-preview-open');
    this.toggleBtn?.addClass('claudian-preview-toggle--active');
    this.toggleBtn?.setAttribute('aria-label', 'Dokumentbibliothek schließen');
    this.toggleBtn?.setAttribute('aria-expanded', 'true');
    if (this.toggleBtn) {
      this.toggleBtn.disabled = true;
      this.toggleBtn.setAttribute('aria-hidden', 'true');
      this.toggleBtn.style.display = 'none';
    }
    this.updatePanelSemantics();
    this.renderLibrary();
    void this.refreshVaultDocuments();
    if (opening) this.closeBtn?.focus();
  }

  close(restoreFocus = true): void {
    if (!this.panelEl) return;
    const focusTarget = this.previouslyFocused;
    this.previouslyFocused = null;
    this.isOpen = false;
    this.panelEl.removeClass('is-open');
    this.containerEl.removeClass('claudian-preview-open');
    this.toggleBtn?.removeClass('claudian-preview-toggle--active');
    this.toggleBtn?.setAttribute('aria-label', 'Dokumentbibliothek öffnen');
    this.toggleBtn?.setAttribute('aria-expanded', 'false');
    if (this.toggleBtn) {
      this.toggleBtn.disabled = false;
      this.toggleBtn.removeAttribute('aria-hidden');
      this.toggleBtn.style.display = '';
    }
    this.updatePanelSemantics();
    if (!restoreFocus) return;
    if (focusTarget && focusTarget.isConnected !== false) focusTarget.focus();
    else this.toggleBtn?.focus();
  }

  private readonly handlePanelKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.isOpen || !this.isFullscreen || !this.panelEl) return;

    const focusable = Array.from(this.panelEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      element.getAttribute('aria-hidden') !== 'true'
      && element.getAttribute('hidden') === null
    ));
    if (focusable.length === 0) {
      event.preventDefault();
      event.stopPropagation();
      this.panelEl.focus();
      return;
    }

    const activeElement = this.containerEl.ownerDocument?.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (activeElement === first || !focusable.includes(activeElement as HTMLElement))) {
      event.preventDefault();
      event.stopPropagation();
      last.focus();
    } else if (!event.shiftKey && (activeElement === last || !focusable.includes(activeElement as HTMLElement))) {
      event.preventDefault();
      event.stopPropagation();
      first.focus();
    }
  };

  private configureFullscreenMode(): void {
    const ownerWindow = this.containerEl.ownerDocument?.defaultView;
    if (!ownerWindow || typeof ownerWindow.matchMedia !== 'function') return;
    this.fullscreenQuery = ownerWindow.matchMedia(FULLSCREEN_MEDIA_QUERY);
    this.isFullscreen = this.fullscreenQuery.matches;
    if (typeof this.fullscreenQuery.addEventListener === 'function') {
      this.fullscreenQuery.addEventListener('change', this.handleFullscreenChange);
    } else {
      this.fullscreenQuery.addListener(this.handleFullscreenChange);
    }
    this.updatePanelSemantics();
  }

  private readonly handleFullscreenChange = (event: MediaQueryListEvent): void => {
    this.isFullscreen = event.matches;
    this.updatePanelSemantics();
  };

  private updatePanelSemantics(): void {
    if (!this.panelEl) return;
    if (this.isOpen && this.isFullscreen) {
      this.panelEl.setAttribute('role', 'dialog');
      this.panelEl.setAttribute('aria-modal', 'true');
    } else {
      this.panelEl.setAttribute('role', 'region');
      this.panelEl.removeAttribute('aria-modal');
    }
  }

  private releaseFullscreenMode(): void {
    if (!this.fullscreenQuery) return;
    if (typeof this.fullscreenQuery.removeEventListener === 'function') {
      this.fullscreenQuery.removeEventListener('change', this.handleFullscreenChange);
    } else {
      this.fullscreenQuery.removeListener(this.handleFullscreenChange);
    }
    this.fullscreenQuery = null;
  }

  rememberUpload(upload: LibraryUpload): void {
    if (isChatImageUpload(upload)) return;
    const id = `upload:${upload.relPath}`;
    const existingIndex = this.items.findIndex((item) => item.id === id);
    if (existingIndex >= 0) this.items.splice(existingIndex, 1);
    this.items.unshift({ id, type: 'upload', ...upload });
    this.renderLibrary();
  }

  /** Adds or updates a document without opening the panel. */
  rememberLiveDocument(
    document: LiveDocument,
    theme?: LiveDocumentTheme,
    options?: { vaultPath?: string; preserveTheme?: boolean },
  ): void {
    const id = `live:${liveDocumentIdentity(document)}`;
    const existingIndex = this.items.findIndex((item) => item.id === id);
    const existing = existingIndex >= 0 ? this.items[existingIndex] : undefined;
    if (existingIndex >= 0) this.items.splice(existingIndex, 1);
    // A vault path belongs to the exact document snapshot discovered at that path.
    // Streaming/in-memory updates must open their current body, not an older saved file.
    const vaultPath = options?.vaultPath;
    this.items.unshift({
      id,
      type: 'live',
      liveDocument: document,
      theme: options?.preserveTheme && existing?.type === 'live'
        ? existing.theme
        : (theme ?? document.theme),
      ...(vaultPath ? { vaultPath } : {}),
    });
    this.renderLibrary();
  }

  /** Explicit dock action: remember the document and reveal the library. */
  async dockLiveDocument(document: LiveDocument, theme?: LiveDocumentTheme): Promise<void> {
    this.rememberLiveDocument(document, theme);
    this.open();
  }

  /** @deprecated Use rememberUpload — the pane is a library, not a file loader. */
  async dockFile(filePath: string): Promise<void> {
    const name = filePath.split('/').pop() ?? filePath;
    this.rememberUpload({ name, relPath: filePath });
    this.open();
  }

  /** Read-only discovery of documents saved through the explicit Save action. */
  async refreshVaultDocuments(): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.loadVaultDocuments().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private async loadVaultDocuments(): Promise<void> {
    const vault = this.plugin.app.vault;
    if (typeof vault.getFiles !== 'function') return;
    const allFiles = vault.getFiles();

    // 1. Claudian documents & artifacts
    const claudianFiles = allFiles
      .filter((file): file is TFile =>
        file instanceof TFile && file.path.startsWith('.claudian/'))
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0));

    const read = typeof vault.cachedRead === 'function'
      ? (file: TFile) => vault.cachedRead(file)
      : (file: TFile) => vault.read(file);

    for (const file of claudianFiles) {
      if (file.extension.toLowerCase() === 'md') {
        try {
          const document = parseLiveDocument(await read(file));
          if (document) {
            this.rememberLiveDocument(document, document.theme, { vaultPath: file.path });
            continue;
          }
        } catch {
          // fall through to regular file
        }
      }
      this.rememberFile(file);
    }

    // 2. Recent vault notes and files touched (excluding internal .obsidian/.git)
    const recentVaultFiles = allFiles
      .filter((file): file is TFile =>
        file instanceof TFile
        && !file.path.startsWith('.obsidian/')
        && !file.path.startsWith('.git/')
        && !file.path.startsWith('.claudian/'))
      .sort((a, b) => (b.stat?.mtime ?? 0) - (a.stat?.mtime ?? 0))
      .slice(0, 30);

    for (const file of recentVaultFiles) {
      this.rememberFile(file);
    }

    if (!this.destroyed) this.renderLibrary();
  }

  rememberFile(file: TFile): void {
    const id = `file:${file.path}`;
    if (this.items.some(item => item.id === id)) return;
    let previewSrc: string | undefined;
    try {
      previewSrc = this.plugin.app.vault.adapter.getResourcePath(file.path);
    } catch {
      // ignore
    }
    this.items.push({
      id,
      type: 'upload',
      name: file.name,
      relPath: file.path,
      previewSrc,
    });
  }

  private renderLibrary(): void {
    if (!this.contentEl || this.destroyed) return;
    this.contentEl.empty();
    this.titleEl?.setText('Bibliothek');
    if (this.countEl) {
      this.countEl.setText(String(this.items.length));
      this.countEl.toggleClass('claudian-hidden', this.items.length === 0);
    }

    if (this.items.length === 0) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: EMPTY_COPY });
      return;
    }

    const library = this.contentEl.createDiv({ cls: 'claudian-preview-library' });
    for (const item of this.items) this.renderCard(library, item);
  }

  private renderCard(parent: HTMLElement, item: LibraryItem): void {
    const isLive = item.type === 'live';
    const isVault = Boolean(item.vaultPath);
    const name = isLive ? item.liveDocument.title : item.name;
    const path = isLive
      ? (item.vaultPath || `.claudian/documents/${item.liveDocument.title}.md`)
      : item.relPath;
    const meta = isLive
      ? { kind: 'document', icon: 'file-text' }
      : attachmentTypeMeta(item.name);

    const liveClasses = isLive ? ` claudian-preview-card--live${isVault ? ' claudian-preview-card--vault' : ''}` : '';

    const row = parent.createEl('button', {
      cls: `claudian-preview-card claudian-preview-row claudian-preview-row--${meta.kind}${liveClasses}`,
      attr: {
        type: 'button',
        'aria-label': `${name} öffnen`,
        'data-library-id': item.id,
      },
    });

    const iconContainer = row.createSpan({ cls: 'claudian-preview-row-icon' });
    setIcon(iconContainer, meta.icon);

    const textDetails = row.createDiv({ cls: 'claudian-preview-row-text' });
    textDetails.createSpan({ cls: 'claudian-preview-card-name claudian-preview-row-name', text: name });

    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) {
      textDetails.createSpan({ cls: 'claudian-preview-row-folder', text: folder });
    }

    const actions = row.createDiv({ cls: 'claudian-preview-card-actions claudian-preview-row-actions' });
    const fileMgrName = getFileManagerName();

    const revealBtn = actions.createEl('button', {
      cls: 'claudian-preview-card-btn clickable-icon',
      attr: {
        type: 'button',
        'aria-label': `In ${fileMgrName} anzeigen`,
        title: `In ${fileMgrName} anzeigen`,
      },
    });
    setIcon(revealBtn, 'folder');
    revealBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void revealInSystemFileManager(this.plugin.app, path);
    });

    const extBtn = actions.createEl('button', {
      cls: 'claudian-preview-card-btn clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'In Standard-App öffnen',
        title: 'In Standard-App öffnen',
      },
    });
    setIcon(extBtn, 'external-link');
    extBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openInDefaultApp(this.plugin.app, path);
    });

    const moreBtn = actions.createEl('button', {
      cls: 'claudian-preview-card-btn clickable-icon',
      attr: {
        type: 'button',
        'aria-label': 'Weitere Aktionen',
        title: 'Weitere Aktionen',
      },
    });
    setIcon(moreBtn, 'more-horizontal');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFileContextMenu(this.plugin.app, e, path);
    });

    row.addEventListener('click', () => void this.openItem(item));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFileContextMenu(this.plugin.app, e, path);
    });
  }

    private async openItem(item: LibraryItem): Promise<void> {
    try {
      if (item.type === 'live' && !item.vaultPath) {
        await openLiveDocumentPreview(this.plugin.app, this.host, item.liveDocument, item.theme);
        return;
      }

      const path = item.type === 'live' ? item.vaultPath : item.relPath;
      if (!path) return;
      const file = this.plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await this.plugin.app.workspace.getLeaf(false).openFile(file);
        return;
      }
      if (typeof this.plugin.app.workspace.openLinkText === 'function') {
        await this.plugin.app.workspace.openLinkText(path, '', false);
        return;
      }
      new Notice(`Datei konnte nicht geöffnet werden: ${path}`);
    } catch {
      new Notice('Der Bibliothekseintrag konnte nicht geöffnet werden.');
    }
  }

  private resolveResourcePath(relPath: string): string | null {
    try {
      return this.plugin.app.vault.adapter.getResourcePath(relPath);
    } catch {
      return null;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.close(false);
    this.releaseFullscreenMode();
    this.panelEl?.removeEventListener('keydown', this.handlePanelKeydown);
    this.host.unload();
    this.panelEl?.remove();
    this.toggleBtn?.remove();
    this.panelEl = null;
    this.toggleBtn = null;
    this.closeBtn = null;
    this.contentEl = null;
    this.titleEl = null;
    this.countEl = null;
  }
}
