import type { App } from 'obsidian';
import { Modal, TFile } from 'obsidian';

import type { RelatedNote } from '../../core/intelligence/rag/relatedNotes';

/**
 * Lists notes semantically related to the active note (Smart Connections-style
 * recall). Clicking a row opens that note; keyboard navigation mirrors the
 * other Claudian pickers (↑/↓ + Enter).
 */
export class RelatedNotesModal extends Modal {
  private itemElements: HTMLElement[] = [];
  private focusedIndex = -1;

  constructor(
    app: App,
    private readonly sourcePath: string,
    private readonly related: RelatedNote[],
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-related-modal');

    const header = contentEl.createDiv({ cls: 'claudian-related-header' });
    header.createEl('h2', { text: 'Verwandte Notizen', cls: 'claudian-related-title' });
    const sourceName = this.sourcePath.split('/').pop() ?? this.sourcePath;
    header.createEl('p', {
      text: `Semantisch ähnlich zu „${sourceName}"`,
      cls: 'claudian-related-subtitle',
    });

    if (this.related.length === 0) {
      const empty = contentEl.createDiv({ cls: 'claudian-related-empty' });
      empty.createEl('p', { text: 'Keine verwandten Notizen gefunden.' });
      empty.createEl('p', {
        text: 'Der Vault-Index wächst im Hintergrund — versuche es später erneut oder schreibe mehr zu diesem Thema.',
        cls: 'claudian-related-empty-hint',
      });
      return;
    }

    const list = contentEl.createDiv({ cls: 'claudian-related-list' });
    for (const note of this.related) {
      const item = list.createDiv({
        cls: 'claudian-related-item',
        attr: { tabIndex: '0', role: 'button' },
      });
      item.dataset.path = note.path;

      const head = item.createDiv({ cls: 'claudian-related-item-head' });
      const name = note.path.split('/').pop() ?? note.path;
      head.createSpan({ cls: 'claudian-related-item-name', text: name.replace(/\.md$/, '') });
      head.createSpan({
        cls: 'claudian-related-item-score',
        text: `${Math.round(Math.max(0, Math.min(1, note.score)) * 100)}%`,
      });

      if (note.path.includes('/')) {
        item.createDiv({ cls: 'claudian-related-item-path', text: note.path });
      }
      if (note.snippet) {
        item.createDiv({ cls: 'claudian-related-item-snippet', text: note.snippet });
      }

      item.addEventListener('click', () => this.openNote(note.path));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.openNote(note.path);
        }
      });
      this.itemElements.push(item);
    }

    this.focusedIndex = 0;
    this.updateFocus();
    contentEl.addEventListener('keydown', (event) => this.handleListKeydown(event));
  }

  onClose(): void {
    this.contentEl.empty();
    this.itemElements = [];
    this.focusedIndex = -1;
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      void this.app.workspace.getLeaf(false).openFile(file);
    }
    this.close();
  }

  private handleListKeydown(event: KeyboardEvent): void {
    if (this.itemElements.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusedIndex = (this.focusedIndex + 1) % this.itemElements.length;
      this.updateFocus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusedIndex = (this.focusedIndex - 1 + this.itemElements.length) % this.itemElements.length;
      this.updateFocus();
    }
  }

  private updateFocus(): void {
    for (let i = 0; i < this.itemElements.length; i++) {
      const item = this.itemElements[i];
      item.toggleClass('claudian-related-item-focused', i === this.focusedIndex);
      if (i === this.focusedIndex) {
        item.focus();
      }
    }
  }
}
