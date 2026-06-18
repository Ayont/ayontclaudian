import { App, Modal } from 'obsidian';
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

  constructor(
    app: App,
    private readonly onSelect: (id: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Resume Kimi session' });

    const rows = buildKimiSessionRows();
    if (rows.length === 0) {
      contentEl.createEl('p', { text: 'No Kimi sessions found.' });
      return;
    }

    const list = contentEl.createEl('div', { cls: 'kimi-session-list' });
    for (const row of rows) {
      const item = list.createEl('div', { cls: 'kimi-session-list-item' });
      item.createEl('span', { text: row.label });
      item.addEventListener('click', () => {
        this.selectedId = row.id;
        this.close();
      });
    }
  }

  onClose(): void {
    if (this.selectedId) {
      this.onSelect(this.selectedId);
    }
    this.contentEl.empty();
  }
}
