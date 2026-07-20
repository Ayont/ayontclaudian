import { type App, FuzzySuggestModal, Notice, type TFile } from 'obsidian';

/**
 * Note picker for "An Notiz anhängen": fuzzy search over all markdown files,
 * with the active note offered first. The chosen note gets the assistant
 * response appended under a small provenance line.
 */
export class AppendToNoteModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly content: string,
  ) {
    super(app);
    this.setPlaceholder('Notiz wählen, an die angehängt wird…');
  }

  getItems(): TFile[] {
    const files = [...this.app.vault.getMarkdownFiles()];
    const active = this.app.workspace.getActiveFile();
    if (active) {
      files.sort((a, b) => (a.path === active.path ? -1 : 0) - (b.path === active.path ? -1 : 0));
    }
    return files;
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    void (async () => {
      const stamp = new Date().toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const block = `\n\n---\n*Claudian · ${stamp}*\n\n${this.content.trim()}\n`;
      await this.app.vault.process(file, (data) => data.replace(/\s+$/, '') + block);
      new Notice(`An „${file.basename}" angehängt.`);
    })().catch(() => {
      new Notice('Anhängen fehlgeschlagen.');
    });
  }
}
