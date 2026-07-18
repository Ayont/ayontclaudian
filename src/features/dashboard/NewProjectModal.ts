import type { App } from 'obsidian';
import { Modal, Setting } from 'obsidian';

import { dashboardStrings } from './dashboardI18n';

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
    const s = dashboardStrings();
    contentEl.empty();
    contentEl.addClass('claudian-new-project-modal');

    contentEl.createEl('h2', { text: s.npTitle, cls: 'claudian-new-project-title' });
    contentEl.createEl('p', { text: s.npSubtitle, cls: 'claudian-new-project-subtitle' });

    const errorEl = contentEl.createDiv({
      cls: 'claudian-new-project-error claudian-hidden',
    });

    new Setting(contentEl)
      .setName(s.npName)
      .setDesc(s.npNameDesc)
      .addText((text) => {
        text.setPlaceholder(s.npNamePlaceholder).onChange((value) => {
          this.name = value;
          errorEl.toggleClass('claudian-hidden', true);
        });
        window.setTimeout(() => text.inputEl.focus(), 30);
      });

    new Setting(contentEl)
      .setName(s.npDescription)
      .setDesc(s.npDescriptionDesc)
      .addTextArea((area) => {
        area.setPlaceholder(s.npDescriptionPlaceholder).onChange((value) => {
          this.description = value;
        });
        area.inputEl.rows = 2;
      });

    new Setting(contentEl)
      .setName(s.npInstructions)
      .setDesc(s.npInstructionsDesc)
      .addTextArea((area) => {
        area.setPlaceholder(s.npInstructionsPlaceholder).onChange((value) => {
          this.instructions = value;
        });
        area.inputEl.rows = 3;
      });

    const actions = contentEl.createDiv({ cls: 'claudian-new-project-actions' });
    const cancelBtn = actions.createEl('button', { text: s.npCancel, attr: { type: 'button' } });
    cancelBtn.addEventListener('click', () => this.close());

    const createBtn = actions.createEl('button', {
      text: s.npCreate,
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
    const s = dashboardStrings();
    const name = this.name.trim();
    if (!name) {
      this.showError(errorEl, s.npErrNameRequired);
      return;
    }
    const slug = projectSlug(name);
    if (!slug) {
      this.showError(errorEl, s.npErrNameInvalid);
      return;
    }
    if (this.existingSlugs.has(slug)) {
      this.showError(errorEl, s.npErrDuplicate(name));
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
