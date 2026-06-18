import type { App } from 'obsidian';
import { Modal } from 'obsidian';

import { listKimiSessionIds } from '../history/KimiSessionStore';

export interface KimiSessionRow {
  id: string;
  label: string;
}

export function buildKimiSessionRows(): KimiSessionRow[] {
  const ids = listKimiSessionIds();
  return ids.map((id) => ({ id, label: id }));
}

export class KimiSessionListModal extends Modal {
  private selectedId: string | null = null;
  private itemElements: HTMLElement[] = [];
  private focusedIndex = -1;

  constructor(
    app: App,
    private readonly onSelect: (id: string) => void,
    private readonly currentGoal?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kimi-session-list-modal');

    const header = contentEl.createDiv({ cls: 'kimi-session-list-header' });
    header.createEl('h2', { text: 'Resume kimi session', cls: 'kimi-session-list-title' });
    header.createEl('p', {
      text: 'Select a recent session to continue where you left off.',
      cls: 'kimi-session-list-subtitle',
    });

    if (this.currentGoal?.trim()) {
      const goalCard = contentEl.createDiv({ cls: 'kimi-goal-card' });
      goalCard.createEl('span', { text: 'Current goal', cls: 'kimi-goal-label' });
      goalCard.createEl('span', { text: this.currentGoal.trim(), cls: 'kimi-goal-text' });
    }

    const rows = buildKimiSessionRows();
    if (rows.length === 0) {
      this.renderEmptyState(contentEl);
      return;
    }

    const list = contentEl.createEl('div', { cls: 'kimi-session-list' });
    for (const row of rows) {
      const item = list.createEl('div', {
        cls: 'kimi-session-list-item',
        attr: { tabIndex: '0', role: 'button' },
      });
      item.dataset.sessionId = row.id;

      const meta = item.createDiv({ cls: 'kimi-session-list-item-meta' });
      meta.createEl('span', { text: row.label, cls: 'kimi-session-list-item-id' });
      meta.createEl('span', { text: 'Kimi session', cls: 'kimi-session-list-item-kind' });

      item.addEventListener('click', () => this.select(row.id));
      item.addEventListener('keydown', (event) => this.handleKeydown(event, item));
      this.itemElements.push(item);
    }

    this.focusedIndex = 0;
    this.updateFocus();

    contentEl.addEventListener('keydown', (event) => this.handleListKeydown(event));
  }

  onClose(): void {
    if (this.selectedId) {
      this.onSelect(this.selectedId);
    }
    this.contentEl.empty();
    this.itemElements = [];
    this.focusedIndex = -1;
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: 'kimi-session-list-empty' });
    empty.createEl('p', { text: 'No kimi sessions found.' });
    empty.createEl('p', {
      text: 'Start a chat with kimi to create your first session.',
      cls: 'kimi-session-list-empty-hint',
    });
  }

  private select(id: string): void {
    this.selectedId = id;
    this.close();
  }

  private handleKeydown(event: KeyboardEvent, item: HTMLElement): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const id = item.dataset.sessionId;
      if (id) {
        this.select(id);
      }
    }
  }

  private handleListKeydown(event: KeyboardEvent): void {
    if (this.itemElements.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusedIndex = (this.focusedIndex + 1) % this.itemElements.length;
      this.updateFocus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusedIndex =
        (this.focusedIndex - 1 + this.itemElements.length) % this.itemElements.length;
      this.updateFocus();
    } else if (event.key === 'Enter' && this.focusedIndex >= 0) {
      event.preventDefault();
      const id = this.itemElements[this.focusedIndex]?.dataset.sessionId;
      if (id) {
        this.select(id);
      }
    }
  }

  private updateFocus(): void {
    for (let i = 0; i < this.itemElements.length; i++) {
      const item = this.itemElements[i];
      item.toggleClass('kimi-session-list-item-focused', i === this.focusedIndex);
      if (i === this.focusedIndex) {
        item.focus();
      }
    }
  }
}
