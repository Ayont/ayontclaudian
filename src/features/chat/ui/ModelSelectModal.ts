import { type App,Modal } from 'obsidian';

import type { ProviderUIOption } from '../../../core/providers/types';
import { createProviderIconSvg } from '../../../shared/icons';

export class ModelSelectModal extends Modal {
  private filter = '';
  private listEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private readonly models: ProviderUIOption[],
    private readonly currentModel: string,
    private readonly onSelect: (value: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Select model');
    this.modalEl.addClass('claudian-model-select-modal');
    this.contentEl.addClass('claudian-model-select-content');

    const frame = this.contentEl.createDiv({ cls: 'claudian-model-select-frame' });

    const searchContainer = frame.createDiv({ cls: 'claudian-model-select-search' });
    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Search models…',
      cls: 'claudian-model-select-search-input',
    });
    this.searchInput.addEventListener('input', (event) => {
      this.filter = (event.target as HTMLInputElement).value.toLowerCase();
      this.renderList();
    });

    this.listEl = frame.createDiv({ cls: 'claudian-model-select-list' });
    this.renderList();

    // Focus the search field after the modal is visible.
    window.requestAnimationFrame(() => {
      this.searchInput?.focus();
    });
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }
    this.listEl.empty();

    const filtered = this.filter
      ? this.models.filter((model) =>
        `${model.label} ${model.group ?? ''} ${model.description ?? ''}`.toLowerCase().includes(this.filter)
      )
      : this.models;

    if (filtered.length === 0) {
      const emptyEl = this.listEl.createDiv({ cls: 'claudian-model-select-empty' });
      emptyEl.setText('No models match your search.');
      return;
    }

    let lastGroup: string | undefined;
    for (const model of filtered) {
      if (model.group && model.group !== lastGroup) {
        const groupEl = this.listEl.createDiv({ cls: 'claudian-model-select-group' });
        groupEl.setText(model.group);
        lastGroup = model.group;
      }

      const optionEl = this.listEl.createDiv({ cls: 'claudian-model-select-option' });
      if (model.value === this.currentModel) {
        optionEl.addClass('is-selected');
      }

      if (model.providerIcon) {
        const iconWrap = optionEl.createSpan({ cls: 'claudian-model-select-option-icon' });
        iconWrap.appendChild(createProviderIconSvg(model.providerIcon, {
          height: 14,
          ownerDocument: iconWrap.ownerDocument,
          width: 14,
        }));
      }

      const labelEl = optionEl.createSpan({ cls: 'claudian-model-select-option-label' });
      labelEl.setText(model.label);

      if (model.value === this.currentModel) {
        const checkEl = optionEl.createSpan({ cls: 'claudian-model-select-option-check' });
        checkEl.setText('✓');
      }

      if (model.description) {
        optionEl.setAttribute('title', model.description);
      }

      optionEl.addEventListener('click', () => {
        this.onSelect(model.value);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
