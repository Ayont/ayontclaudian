import { ItemView, TFile, type WorkspaceLeaf } from 'obsidian';

import type { RelatedNote } from '../../core/intelligence/rag/relatedNotes';
import type ClaudianPlugin from '../../main';

export const VIEW_TYPE_CLAUDIAN_RELATED = 'claudian-related-notes';

/** Debounce active-file changes so rapid tab switching doesn't thrash the index. */
const REFRESH_DEBOUNCE_MS = 350;

/**
 * Ambient "related notes" side panel — the zero-command, passive-recall surface
 * users expect (Smart Connections style). Watches the active note and shows the
 * semantically closest other notes; click to open. Reuses the same computation
 * as the "Verwandte Notizen finden" command.
 */
export class RelatedNotesView extends ItemView {
  private listEl: HTMLElement | null = null;
  private headerPathEl: HTMLElement | null = null;
  private debounceTimer: number | null = null;
  private currentPath: string | null = null;
  private renderToken = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN_RELATED;
  }

  getDisplayText(): string {
    return 'Verwandte Notizen';
  }

  getIcon(): string {
    return 'git-fork';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('claudian-related-panel');

    const header = container.createDiv({ cls: 'claudian-related-panel-header' });
    header.createEl('span', { text: 'Verwandte Notizen', cls: 'claudian-related-panel-title' });
    this.headerPathEl = header.createEl('span', { cls: 'claudian-related-panel-source' });

    this.listEl = container.createDiv({ cls: 'claudian-related-panel-list' });

    // Refresh on note changes; registerEvent auto-unsubscribes on view close.
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRefresh()));

    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.contentEl.empty();
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  private getActiveMarkdownFile(): TFile | null {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' ? file : null;
  }

  private async refresh(): Promise<void> {
    if (!this.listEl) return;

    const file = this.getActiveMarkdownFile();
    if (!file) {
      this.currentPath = null;
      this.setSource(null);
      this.renderMessage('Öffne eine Notiz, um verwandte Notizen zu sehen.');
      return;
    }

    // Skip redundant recomputation when the active note hasn't changed.
    if (file.path === this.currentPath && this.listEl.childElementCount > 0) {
      return;
    }
    this.currentPath = file.path;
    this.setSource(file.path);

    if (this.plugin.settings.memoryEnabled === false) {
      this.renderMessage('Aktiviere „Memory/RAG" in den Claudian-Einstellungen.');
      return;
    }
    if (this.plugin.vectorStore.size() === 0) {
      this.renderMessage(this.plugin.vaultRAGService.indexing
        ? 'Der Vault-Index wird gerade aufgebaut …'
        : 'Der Vault-Index ist noch leer. Führe „Reindex vault for RAG" aus.');
      return;
    }

    const token = ++this.renderToken;
    this.renderMessage('Suche verwandte Notizen …');

    let related: RelatedNote[];
    try {
      related = await this.plugin.computeRelatedNotes(file);
    } catch {
      if (token === this.renderToken) this.renderMessage('Suche fehlgeschlagen.');
      return;
    }

    // A newer refresh started while we awaited — drop this stale result.
    if (token !== this.renderToken) return;
    this.renderResults(related);
  }

  private setSource(path: string | null): void {
    if (!this.headerPathEl) return;
    this.headerPathEl.setText(path ? (path.split('/').pop() ?? path).replace(/\.md$/, '') : '');
  }

  private renderMessage(text: string): void {
    if (!this.listEl) return;
    this.listEl.empty();
    this.listEl.createDiv({ cls: 'claudian-related-panel-message', text });
  }

  private renderResults(related: RelatedNote[]): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (related.length === 0) {
      this.renderMessage('Keine verwandten Notizen gefunden.');
      return;
    }

    for (const note of related) {
      const item = this.listEl.createDiv({
        cls: 'claudian-related-item',
        attr: { tabIndex: '0', role: 'button' },
      });

      const head = item.createDiv({ cls: 'claudian-related-item-head' });
      const name = (note.path.split('/').pop() ?? note.path).replace(/\.md$/, '');
      head.createSpan({ cls: 'claudian-related-item-name', text: name });
      head.createSpan({
        cls: 'claudian-related-item-score',
        text: `${Math.round(Math.max(0, Math.min(1, note.score)) * 100)}%`,
      });

      if (note.snippet) {
        item.createDiv({ cls: 'claudian-related-item-snippet', text: note.snippet });
      }

      const open = () => {
        const file = this.app.vault.getAbstractFileByPath(note.path);
        if (file instanceof TFile) {
          void this.app.workspace.getLeaf(false).openFile(file);
        }
      };
      item.addEventListener('click', open);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    }
  }
}
