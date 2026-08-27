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
});
