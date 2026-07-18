import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

export interface NewProjectValues {
  name: string;
  description: string;
  instructions: string;
}

/** Derive the project id/slug the way ProjectService does, for duplicate checks. */
export function projectSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Prompt for a project's name/description/instructions instead of silently
 * creating a fixed "New Project". `existingSlugs` blocks duplicate ids up front
 * (ProjectService derives the id from the name, so a collision would throw).
 */
export class NewProjectModal extends Modal {
  private name = '';
  private description = '';
  private instructions = '';
  private submitted = false;

  constructor(
    app: App,
    private readonly existingSlugs: Set<string>,
    private readonly onSubmit: (values: NewProjectValues) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-new-project-modal');

    contentEl.createEl('h2', { text: 'Neues Projekt', cls: 'claudian-new-project-title' });
    contentEl.createEl('p', {
      text: 'Projekte bündeln Instruktionen, Skills und Erinnerungen für einen Arbeitskontext.',
      cls: 'claudian-new-project-subtitle',
    });

    const errorEl = contentEl.createDiv({
      cls: 'claudian-new-project-error claudian-hidden',
    });

    new Setting(contentEl)
      .setName('Name')
      .setDesc('Pflichtfeld. Bestimmt den Ordner- und Dateinamen des Projekts.')
      .addText((text) => {
        text.setPlaceholder('z. B. Veylor Backend').onChange((value) => {
          this.name = value;
          errorEl.toggleClass('claudian-hidden', true);
        });
        window.setTimeout(() => text.inputEl.focus(), 30);
      });

    new Setting(contentEl)
      .setName('Beschreibung')
      .setDesc('Optional. Wofür ist dieses Projekt?')
      .addTextArea((area) => {
        area.setPlaceholder('Kurzbeschreibung …').onChange((value) => {
          this.description = value;
        });
        area.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .setName('Instruktionen')
      .setDesc('Optional. Systemhinweise, die bei aktivem Projekt immer mitgegeben werden.')
      .addTextArea((area) => {
        area.setPlaceholder('z. B. Antworte immer auf Deutsch, nutze Java 21 …').onChange((value) => {
          this.instructions = value;
        });
        area.inputEl.rows = 3;
      });

    const actions = contentEl.createDiv({ cls: 'claudian-new-project-actions' });
    const cancelBtn = actions.createEl('button', { text: 'Abbrechen', attr: { type: 'button' } });
    cancelBtn.addEventListener('click', () => this.close());

    const createBtn = actions.createEl('button', {
      text: 'Projekt erstellen',
      cls: 'mod-cta',
      attr: { type: 'button' },
    });
    createBtn.addEventListener('click', () => this.trySubmit(errorEl));

    this.scope.register([], 'Enter', (evt) => {
      // Ignore Enter inside a textarea (allow multi-line input there).
      if ((evt.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      evt.preventDefault();
      this.trySubmit(errorEl);
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private trySubmit(errorEl: HTMLElement): void {
    const name = this.name.trim();
    if (!name) {
      this.showError(errorEl, 'Bitte gib einen Projektnamen ein.');
      return;
    }
    const slug = projectSlug(name);
    if (!slug) {
      this.showError(errorEl, 'Der Name muss mindestens einen Buchstaben oder eine Ziffer enthalten.');
      return;
    }
    if (this.existingSlugs.has(slug)) {
      this.showError(errorEl, `Ein Projekt „${name}" existiert bereits.`);
      return;
    }
    this.submitted = true;
    this.close();
    this.onSubmit({
      name,
      description: this.description.trim(),
      instructions: this.instructions.trim(),
    });
  }

  private showError(errorEl: HTMLElement, message: string): void {
    errorEl.setText(message);
    errorEl.toggleClass('claudian-hidden', false);
  }
}
