import { type App, Modal } from 'obsidian';

import { type GroupedModelOption, groupModelOptions } from '../../../core/providers/modelOptionGroups';
import type { ProviderUIOption } from '../../../core/providers/types';
import { AUTO_MODEL_VALUE } from '../../../core/routing/modelRouterRules';
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
    this.titleEl.setText('Modell wählen');
    this.modalEl.addClass('claudian-model-select-modal');
    this.contentEl.addClass('claudian-model-select-content');

    const frame = this.contentEl.createDiv({ cls: 'claudian-model-select-frame' });

    const summary = frame.createDiv({ cls: 'claudian-model-select-summary' });
    const providerCount = new Set(this.models.map((model) => model.providerId).filter(Boolean)).size;
    summary.createSpan({ text: `${this.models.length} Modelle · ${providerCount} Anbieter` });
    summary.createSpan({ cls: 'claudian-model-select-summary-hint', text: 'Esc zum Schließen' });

    const searchContainer = frame.createDiv({ cls: 'claudian-model-select-search' });
    this.searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: 'Modelle durchsuchen…',
      cls: 'claudian-model-select-search-input',
    });
    this.searchInput.setAttribute('aria-label', 'Modelle durchsuchen');
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
      emptyEl.setText('Keine Modelle passen zur Suche.');
      return;
    }

    const grouped = groupModelOptions(filtered);
    let lastGroup: string | undefined;
    for (const family of grouped) {
      if (family.group && family.group !== lastGroup) {
        const groupEl = this.listEl.createDiv({ cls: 'claudian-model-select-group' });
        groupEl.setText(family.group);
        lastGroup = family.group;
      }
      this.renderFamily(family);
    }
  }

  private renderFamily(family: GroupedModelOption): void {
    if (!this.listEl) return;
    const selectedValue = family.variants.some((variant) => variant.value === this.currentModel)
      ? this.currentModel
      : family.variants.length === 0 && family.primaryValue === this.currentModel
        ? this.currentModel
        : null;
    const hasVariants = family.variants.length > 1;
    const optionEl = hasVariants
      ? this.listEl.createDiv({ cls: 'claudian-model-select-option' })
      : this.listEl.createEl('button', {
        cls: 'claudian-model-select-option',
        attr: {
          type: 'button',
          'aria-pressed': String(selectedValue !== null),
        },
      });
    if (hasVariants) {
      optionEl.setAttribute('role', 'group');
      optionEl.setAttribute('aria-label', family.familyLabel);
    }
    if (family.providerId) optionEl.dataset.provider = family.providerId;
    if (selectedValue) optionEl.addClass('is-selected');
    if (family.primaryValue === AUTO_MODEL_VALUE) optionEl.addClass('is-auto');

    if (family.providerIcon) {
      const iconWrap = optionEl.createSpan({ cls: 'claudian-model-select-option-icon' });
      iconWrap.appendChild(createProviderIconSvg(family.providerIcon, {
        height: 14,
        ownerDocument: iconWrap.ownerDocument,
        width: 14,
      }));
    } else if (family.primaryValue === AUTO_MODEL_VALUE) {
      const iconWrap = optionEl.createSpan({ cls: 'claudian-model-select-option-icon' });
      iconWrap.setText('✦');
    }

    const labelEl = optionEl.createSpan({ cls: 'claudian-model-select-option-label' });
    labelEl.setText(family.familyLabel);

    if (family.variants.length > 1) {
      const chips = optionEl.createDiv({ cls: 'claudian-model-select-efforts' });
      for (const variant of family.variants) {
        const chip = chips.createEl('button', {
          cls: 'claudian-model-select-effort',
          text: variant.label,
          attr: {
            type: 'button',
            'aria-pressed': String(variant.value === this.currentModel),
            'aria-label': `${family.familyLabel}: ${variant.label}`,
          },
        });
        if (variant.value === this.currentModel) chip.addClass('is-active');
        chip.addEventListener('click', (event) => {
          event.stopPropagation();
          this.onSelect(variant.value);
          this.close();
        });
      }
    }

    if (family.description) {
      optionEl.createSpan({ cls: 'claudian-model-select-option-description', text: family.description });
      optionEl.setAttribute('title', family.description);
    }

    if (selectedValue && family.variants.length === 0) {
      const checkEl = optionEl.createSpan({ cls: 'claudian-model-select-option-check' });
      checkEl.setText('✓');
    }

    if (!hasVariants) {
      optionEl.addEventListener('click', () => {
        this.onSelect(selectedValue ?? family.primaryValue);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
