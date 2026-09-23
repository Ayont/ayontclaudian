import { Component, Notice, setIcon, TFile } from 'obsidian';

import type ClaudianPlugin from '../../../main';
import {
  type LiveDocument,
  liveDocumentIdentity,
  type LiveDocumentTheme,
  openLiveDocumentPreview,
  parseLiveDocument,
} from '../rendering/LiveDocumentRenderer';
import { getFileManagerName, openInDefaultApp, revealInSystemFileManager, showFileContextMenu } from '../services/FileActionService';
import {
  attachmentTypeMeta,
} from './file-drop/attachmentMeta';
import { createPdfPeekSrcFromBytes } from './file-drop/pdfPeek';
import { LibrarySearchIndex } from './library/libraryIndex';
import { describeLibraryItem, type LibraryItem } from './library/libraryItem';
import { createLibraryRow, type LibraryRowView } from './library/libraryRow';
import { LibraryThumbnailLoader, planLibraryThumbnail } from './library/libraryThumbnails';

const EMPTY_COPY = 'Erstellte Dokumente und Uploads erscheinen hier.';
const NO_RESULTS_HINT = 'Tipp: Nach Typ suchen, etwa „pdf“, „bild“ oder „tabelle“.';
const FULLSCREEN_MEDIA_QUERY = '(max-width: 768px)';
// Focusing the field on touch devices would pop the keyboard over the list.
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';
// Reading a huge PDF into memory for a 40px peek is not worth it.
const PDF_PEEK_MAX_BYTES = 25 * 1024 * 1024;
let nextPanelId = 1;

function isChatImageUpload(upload: LibraryUpload): boolean {
  if (upload.relPath.startsWith('data:image')) return true;
  return attachmentTypeMeta(upload.name).kind === 'image';
}

export interface LiveWorkSource {
  subscribe: (listener: () => void) => () => void;
  runningCount: () => number;
}

function createLiveChip(header: HTMLElement, before: HTMLElement | null): HTMLButtonElement {
  const chip = header.createEl('button', {
    cls: 'claudian-preview-live claudian-hidden',
    attr: { type: 'button' },
  }) as HTMLButtonElement;
  chip.createSpan({ cls: 'claudian-preview-live-dot' }).setAttribute('aria-hidden', 'true');
  chip.createSpan({ cls: 'claudian-preview-live-label' });
  // Narrow drawers show only the number; the label stays in aria-label.
  chip.createSpan({ cls: 'claudian-preview-live-count' }).setAttribute('aria-hidden', 'true');
  if (before) header.insertBefore(chip, before);
  return chip;
}

export interface LibraryUpload {
  name: string;
  relPath: string;
  previewSrc?: string;
}

/** Persistent, non-destructive library of generated documents and uploads. */
export class FilePreviewPanel {
  private panelEl: HTMLElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private closeBtn: HTMLButtonElement | null = null;
  private titleEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private liveEl: HTMLButtonElement | null = null;
  private liveLabelEl: HTMLElement | null = null;
  private liveUnsubscribe: (() => void) | null = null;
  private liveOnShow: (() => void) | null = null;
  private contentEl: HTMLElement | null = null;
  private searchEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchClearBtn: HTMLButtonElement | null = null;
  private searchCountEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private showingEmpty: boolean | null = null;
  private noResultsEl: HTMLElement | null = null;
  private noResultsTitleEl: HTMLElement | null = null;
  private thumbnails: LibraryThumbnailLoader | null = null;
  private query = '';
  private visibleRows: LibraryRowView[] = [];
  private isOpen = false;
  private isFullscreen = false;
  private destroyed = false;
  private previouslyFocused: HTMLElement | null = null;
  private fullscreenQuery: MediaQueryList | null = null;
  private refreshPromise: Promise<void> | null = null;
  private readonly host = new Component();
  private readonly items: LibraryItem[] = [];
  private readonly rowViews = new WeakMap<LibraryItem, LibraryRowView>();
  private readonly searchIndex = new LibrarySearchIndex<LibraryItem>(describeLibraryItem);
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
    this.headerEl = header;
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

    this.renderSearch(this.panelEl);
    this.contentEl = this.panelEl.createDiv({ cls: 'claudian-preview-content' });
    this.renderContentSkeleton(this.contentEl);
    this.thumbnails = new LibraryThumbnailLoader({
      win: this.containerEl.ownerDocument?.defaultView ?? null,
      root: this.contentEl,
      loadPdfPeek: (path) => this.loadPdfPeek(path),
    });
    this.configureFullscreenMode();
    this.renderLibrary();
    void this.refreshVaultDocuments();
  }

  private renderSearch(parent: HTMLElement): void {
    this.searchEl = parent.createDiv({ cls: 'claudian-preview-search claudian-hidden' });
    this.searchEl.setAttribute('role', 'search');
    const searchIcon = this.searchEl.createSpan({ cls: 'claudian-preview-search-icon' });
    searchIcon.setAttribute('aria-hidden', 'true');
    setIcon(searchIcon, 'search');
    this.searchInput = this.searchEl.createEl('input', {
      cls: 'claudian-preview-search-input',
      attr: {
        type: 'text',
        name: 'library-search',
        'aria-label': 'Bibliothek durchsuchen',
        placeholder: 'Name, Ordner oder Typ …',
        'aria-controls': `${this.panelId}-list`,
        autocomplete: 'off',
        spellcheck: 'false',
        enterkeyhint: 'search',
      },
    }) as HTMLInputElement;
    this.searchCountEl = this.searchEl.createSpan({ cls: 'claudian-preview-search-count' });
    this.searchCountEl.setAttribute('aria-live', 'polite');
    this.searchClearBtn = this.searchEl.createEl('button', {
      cls: 'claudian-preview-search-clear clickable-icon claudian-hidden',
      attr: { type: 'button', 'aria-label': 'Suche leeren' },
    }) as HTMLButtonElement;
    setIcon(this.searchClearBtn, 'x');
    this.searchClearBtn.addEventListener('click', () => this.clearSearch());
    this.searchInput.addEventListener('input', this.handleSearchInput);
    this.searchInput.addEventListener('keydown', this.handleSearchKeydown);
  }

  private renderContentSkeleton(parent: HTMLElement): void {
    this.listEl = parent.createDiv({ cls: 'claudian-preview-library' });
    this.listEl.setAttribute('id', `${this.panelId}-list`);
    this.listEl.setAttribute('role', 'list');
    this.listEl.setAttribute('aria-label', 'Bibliothekseinträge');
    this.listEl.addEventListener('keydown', this.handleListKeydown);

    this.noResultsEl = parent.createDiv({ cls: 'claudian-preview-no-results claudian-hidden' });
    this.noResultsTitleEl = this.noResultsEl.createEl('p', { cls: 'claudian-preview-no-results-title' });
    this.noResultsEl.createEl('p', { cls: 'claudian-preview-no-results-hint', text: NO_RESULTS_HINT });
    const reset = this.noResultsEl.createEl('button', {
      cls: 'claudian-preview-no-results-reset',
      attr: { type: 'button' },
      text: 'Suche zurücksetzen',
    });
    reset.addEventListener('click', () => this.clearSearch());
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
    if (opening) this.focusOnOpen();
  }

  private focusOnOpen(): void {
    const win = this.containerEl.ownerDocument?.defaultView;
    const finePointer = typeof win?.matchMedia === 'function' && win.matchMedia(FINE_POINTER_QUERY).matches;
    if (finePointer && this.items.length > 0 && this.searchInput) {
      this.searchInput.focus({ preventScroll: true });
      return;
    }
    this.closeBtn?.focus();
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
      if (this.query) this.clearSearch();
      else this.close();
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
    if (!this.contentEl || !this.listEl || this.destroyed) return;
    const total = this.items.length;
    this.titleEl?.setText('Bibliothek');
    if (this.countEl) {
      this.countEl.setText(String(total));
      this.countEl.toggleClass('claudian-hidden', total === 0);
    }
    this.searchEl?.toggleClass('claudian-hidden', total === 0);
    this.syncEmptyState(total === 0);
    this.syncRowOrder();
    this.applyFilter();
  }

  /** Swaps the empty copy and the list only when the state flips, so a focused row survives. */
  private syncEmptyState(showEmpty: boolean): void {
    if (!this.contentEl || !this.listEl || !this.noResultsEl || this.showingEmpty === showEmpty) return;
    this.showingEmpty = showEmpty;
    this.contentEl.empty();
    if (showEmpty) {
      this.contentEl.createEl('p', { cls: 'claudian-preview-empty', text: EMPTY_COPY });
      return;
    }
    this.contentEl.appendChild(this.listEl);
    this.contentEl.appendChild(this.noResultsEl);
  }

  /** Rows are built once per item; re-rendering only reorders when needed. */
  private syncRowOrder(): void {
    const listEl = this.listEl;
    if (!listEl) return;
    const rows = this.items.map((item) => this.rowFor(item).el);
    const current = Array.from(listEl.children);
    if (current.length === rows.length && rows.every((row, index) => current[index] === row)) return;
    // Re-appending moves the focused row, which drops focus; restore it.
    const focused = this.containerEl.ownerDocument?.activeElement as HTMLElement | null;
    listEl.empty();
    for (const row of rows) listEl.appendChild(row);
    if (focused && focused !== this.containerEl.ownerDocument?.activeElement && listEl.contains(focused)) {
      focused.focus({ preventScroll: true });
    }
  }

  private rowFor(item: LibraryItem): LibraryRowView {
    const cached = this.rowViews.get(item);
    if (cached) return cached;
    const details = describeLibraryItem(item);
    const view = createLibraryRow(this.listEl!, {
      itemId: item.id,
      details,
      isLive: item.type === 'live',
      isVault: item.type === 'live' && Boolean(item.vaultPath),
      plan: planLibraryThumbnail(item, (relPath) => this.resolveResourcePath(relPath)),
      fileManagerName: getFileManagerName(),
      actions: {
        open: () => void this.openItem(item),
        reveal: () => void revealInSystemFileManager(this.plugin.app, details.path),
        openExternal: () => void openInDefaultApp(this.plugin.app, details.path),
        showMenu: (event) => showFileContextMenu(this.plugin.app, event, details.path),
      },
    });
    this.rowViews.set(item, view);
    return view;
  }

  private applyFilter(): void {
    const result = this.searchIndex.search(this.items, this.query);
    const matches = new Map(result.matches.map((match) => [match.item, match]));
    this.visibleRows = [];
    for (const item of this.items) {
      const view = this.rowFor(item);
      const match = matches.get(item);
      view.el.toggleClass('claudian-hidden', !match);
      if (!match) continue;
      view.setHighlight(match.nameRanges, match.folderRanges);
      this.visibleRows.push(view);
      // Closed panels and filtered-out rows never fetch or generate a thumbnail.
      if (this.isOpen) this.thumbnails?.request(view.thumbnail);
    }
    this.syncSearchStatus(this.visibleRows.length, result.total);
  }

  private syncSearchStatus(visible: number, total: number): void {
    const searching = this.query.trim().length > 0;
    this.searchCountEl?.setText(searching ? `${visible} von ${total}` : '');
    this.searchClearBtn?.toggleClass('claudian-hidden', this.query.length === 0);
    const noResults = searching && visible === 0 && total > 0;
    this.noResultsEl?.toggleClass('claudian-hidden', !noResults);
    this.listEl?.toggleClass('claudian-hidden', noResults || total === 0);
    if (noResults) this.noResultsTitleEl?.setText(`Keine Treffer für „${this.query.trim()}“`);
  }

  private setQuery(value: string): void {
    if (value === this.query) return;
    this.query = value;
    this.applyFilter();
  }

  private clearSearch(): void {
    if (this.searchInput) this.searchInput.value = '';
    this.setQuery('');
    this.searchInput?.focus();
  }

  private readonly handleSearchInput = (): void => {
    this.setQuery(this.searchInput?.value ?? '');
  };

  private readonly handleSearchKeydown = (event: KeyboardEvent): void => {
    const first = this.visibleRows[0];
    if (!first) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      first.openEl.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      first.openEl.click();
    }
  };

  private readonly handleListKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target as HTMLElement | null;
    const rowEl = target?.closest?.('.claudian-preview-row') ?? null;
    const index = this.visibleRows.findIndex((view) => view.el === rowEl);
    if (index < 0) return;
    event.preventDefault();
    const next = index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0) {
      this.searchInput?.focus();
      return;
    }
    this.visibleRows[Math.min(next, this.visibleRows.length - 1)].openEl.focus();
  };

  private async loadPdfPeek(path: string): Promise<string | null> {
    const vault = this.plugin.app.vault;
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || typeof vault.readBinary !== 'function') return null;
    if ((file.stat?.size ?? 0) > PDF_PEEK_MAX_BYTES) return null;
    const bytes = await vault.readBinary(file);
    return createPdfPeekSrcFromBytes(new Uint8Array(bytes));
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

  /**
   * The library and the live-work overview share the chat's top-right corner.
   * Where the drawer leaves no room beside it (CSS decides by chat width), the
   * overview steps back and this chip says what is still running; a click
   * hands over to the overview.
   */
  connectLiveWork(source: LiveWorkSource, onShow: () => void): void {
    this.liveUnsubscribe?.();
    if (!this.headerEl) return;
    if (!this.liveEl) {
      this.liveEl = createLiveChip(this.headerEl, this.countEl);
      this.liveLabelEl = this.liveEl.querySelector('.claudian-preview-live-label');
      this.liveEl.addEventListener('click', () => {
        this.close(false);
        this.liveOnShow?.();
      });
    }
    const chip = this.liveEl;
    this.liveOnShow = onShow;
    const update = (): void => {
      const running = source.runningCount();
      chip.toggleClass('claudian-hidden', running === 0);
      const label = `${running} ${running === 1 ? 'Subagent' : 'Subagents'} aktiv`;
      this.liveLabelEl?.setText(label);
      chip.querySelector('.claudian-preview-live-count')?.setText(String(running));
      chip.setAttribute('aria-label', `${label} – Live-Arbeit anzeigen`);
    };
    update();
    this.liveUnsubscribe = source.subscribe(update);
  }

  destroy(): void {
    this.destroyed = true;
    this.liveUnsubscribe?.();
    this.liveUnsubscribe = null;
    this.close(false);
    this.releaseFullscreenMode();
    this.panelEl?.removeEventListener('keydown', this.handlePanelKeydown);
    this.searchInput?.removeEventListener('input', this.handleSearchInput);
    this.searchInput?.removeEventListener('keydown', this.handleSearchKeydown);
    this.listEl?.removeEventListener('keydown', this.handleListKeydown);
    this.thumbnails?.destroy();
    this.thumbnails = null;
    this.host.unload();
    this.panelEl?.remove();
    this.toggleBtn?.remove();
    this.panelEl = null;
    this.toggleBtn = null;
    this.closeBtn = null;
    this.contentEl = null;
    this.titleEl = null;
    this.countEl = null;
    this.searchEl = null;
    this.searchInput = null;
    this.searchClearBtn = null;
    this.searchCountEl = null;
    this.listEl = null;
    this.noResultsEl = null;
    this.noResultsTitleEl = null;
    this.visibleRows = [];
  }
}
