import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';

export class AgyChangelogModal extends Modal {
  constructor(
    app: App,
    private readonly changelogContent: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('claudian-agy-changelog-modal');

    // Title / Header
    const header = contentEl.createDiv({ cls: 'claudian-agy-modal-header' });
    header.createEl('h2', { text: 'Antigravity CLI Changelog', cls: 'claudian-agy-modal-title' });
    header.createEl('p', {
      text: 'Changelog and release notes from the agy binary.',
      cls: 'claudian-agy-modal-subtitle',
    });

    // Content container (Scrollable)
    const bodyContainer = contentEl.createDiv({ cls: 'claudian-agy-modal-body' });
    const pre = bodyContainer.createEl('pre', { cls: 'claudian-agy-modal-pre' });
    pre.createEl('code', { text: this.changelogContent });

    // Footer button to close
    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText('Close')
        .setCta()
        .onClick(() => {
          this.close();
        }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
