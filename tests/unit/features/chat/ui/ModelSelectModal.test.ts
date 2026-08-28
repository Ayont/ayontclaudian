import { createMockEl } from '@test/helpers/mockElement';
import { App } from 'obsidian';

import { ModelSelectModal } from '@/features/chat/ui/ModelSelectModal';

describe('ModelSelectModal', () => {
  it('renders single models as buttons and variant families as labelled groups', () => {
    const modal = new ModelSelectModal(
      new App(),
      [
        { value: 'plain', label: 'Plain', providerId: 'test' },
        { value: 'family (Low)', label: 'Family (Low)', providerId: 'test' },
        { value: 'family (High)', label: 'Family (High)', providerId: 'test' },
      ],
      'plain',
      jest.fn(),
    );
    (modal as any).modalEl = createMockEl();
    (modal as any).titleEl = createMockEl();
    (modal as any).contentEl = createMockEl();

    ModelSelectModal.prototype.onOpen.call(modal);

    const options = (modal as any).contentEl.querySelectorAll('.claudian-model-select-option');
    expect(options[0].tagName).toBe('BUTTON');
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    expect(options[1].tagName).toBe('DIV');
    expect(options[1].getAttribute('role')).toBe('group');
    expect(options[1].getAttribute('aria-label')).toBe('family');
    const effortButtons = (modal as any).contentEl.querySelectorAll('.claudian-model-select-effort');
    expect(effortButtons).toHaveLength(2);
    expect(effortButtons.every((button: { tagName: string }) => button.tagName === 'BUTTON')).toBe(true);
  });

  it('exposes exactly one current model and keeps hover candidates unselected', () => {
    const modal = new ModelSelectModal(
      new App(),
      [
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', providerId: 'codex' },
        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', providerId: 'codex' },
      ],
      'gpt-5.6-sol',
      jest.fn(),
    );
    (modal as any).modalEl = createMockEl();
    (modal as any).titleEl = createMockEl();
    (modal as any).contentEl = createMockEl();

    ModelSelectModal.prototype.onOpen.call(modal);

    const options = (modal as any).contentEl.querySelectorAll('.claudian-model-select-option');
    const selected = options.filter((option: any) => option.getAttribute('aria-current') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0].querySelector('.claudian-model-select-option-label')?.textContent).toBe('GPT-5.6 Sol');
    expect(selected[0].querySelector('.claudian-model-select-option-check')).not.toBeNull();
    expect(options[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('waits for an asynchronous selection before closing', async () => {
    let resolveSelection!: () => void;
    const onSelect = jest.fn(() => new Promise<void>((resolve) => {
      resolveSelection = resolve;
    }));
    const modal = new ModelSelectModal(
      new App(),
      [{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', providerId: 'codex' }],
      'gpt-5.6-sol',
      onSelect,
    );
    (modal as any).modalEl = createMockEl();
    (modal as any).titleEl = createMockEl();
    (modal as any).contentEl = createMockEl();
    (modal as any).close = jest.fn();
    ModelSelectModal.prototype.onOpen.call(modal);

    const option = (modal as any).contentEl.querySelector('.claudian-model-select-option');
    option.click();
    await Promise.resolve();

    expect(onSelect).toHaveBeenCalledWith('gpt-5.6-terra');
    expect((modal as any).close).not.toHaveBeenCalled();
    expect((modal as any).modalEl.hasClass('is-selecting')).toBe(true);

    resolveSelection();
    await Promise.resolve();
    await Promise.resolve();

    expect((modal as any).close).toHaveBeenCalledTimes(1);
  });

  it('stays open when an asynchronous selection fails', async () => {
    const modal = new ModelSelectModal(
      new App(),
      [{ value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', providerId: 'codex' }],
      'gpt-5.6-sol',
      jest.fn().mockRejectedValue(new Error('save failed')),
    );
    (modal as any).modalEl = createMockEl();
    (modal as any).titleEl = createMockEl();
    (modal as any).contentEl = createMockEl();
    (modal as any).close = jest.fn();
    ModelSelectModal.prototype.onOpen.call(modal);

    const option = (modal as any).contentEl.querySelector('.claudian-model-select-option');
    option.click();
    await Promise.resolve();
    await Promise.resolve();

    expect((modal as any).close).not.toHaveBeenCalled();
    expect((modal as any).modalEl.hasClass('is-selecting')).toBe(false);
  });
});
