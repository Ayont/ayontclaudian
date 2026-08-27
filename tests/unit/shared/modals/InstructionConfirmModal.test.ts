import { createMockEl } from '@test/helpers/mockElement';

import {
  InstructionModal,
  type InstructionModalCallbacks,
} from '@/shared/modals/InstructionConfirmModal';

function createMockCallbacks(
  overrides: Partial<InstructionModalCallbacks> = {}
): InstructionModalCallbacks {
  return {
    onAccept: jest.fn(),
    onReject: jest.fn(),
    onClarificationSubmit: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function openModal(
  rawInstruction: string,
  callbacks: InstructionModalCallbacks
): InstructionModal {
  const modal = new InstructionModal({} as any, rawInstruction, callbacks);
  (modal as any).setTitle = jest.fn();
  (modal as any).contentEl = createMockEl();
  (modal as any).close = jest.fn();
  InstructionModal.prototype.onOpen.call(modal);
  return modal;
}

function findByClass(root: any, cls: string): any {
  if (root.hasClass?.(cls)) return root;
  for (const child of root.children || []) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

function findAllByClass(root: any, cls: string): any[] {
  const results: any[] = [];
  const collect = (el: any) => {
    if (el.hasClass?.(cls)) results.push(el);
    for (const child of el.children || []) collect(child);
  };
  collect(root);
  return results;
}

function clickButton(root: any, text: string): void {
  const buttons = findAllByClass(root, 'claudian-instruction-btn');
  const btn = buttons.find((b: any) => b.textContent === text);
  if (!btn) throw new Error(`Button "${text}" not found`);
  btn.click();
}

describe('InstructionModal', () => {
  describe('onOpen', () => {
    it('renders the raw instruction text', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('Make it better', callbacks);
      const contentEl = (modal as any).contentEl;

      const originalEl = findByClass(contentEl, 'claudian-instruction-original');
      expect(originalEl).not.toBeNull();
      expect(originalEl.textContent).toBe('Make it better');
    });

    it('uses German labels and exposes loading progress to assistive technology', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      expect((modal as any).setTitle).toHaveBeenCalledWith('Eigene Anweisung hinzufügen');
      expect(findByClass(contentEl, 'claudian-instruction-label').textContent).toBe('Deine Eingabe:');

      const loadingEl = findByClass(contentEl, 'claudian-instruction-loading');
      expect(loadingEl.getAttribute('role')).toBe('status');
      expect(loadingEl.getAttribute('aria-live')).toBe('polite');
      expect(loadingEl.children[1]?.textContent).toBe('Anweisung wird verarbeitet …');
    });

    it('starts in loading state', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      const loadingEl = findByClass(contentEl, 'claudian-instruction-loading');
      expect(loadingEl).not.toBeNull();
      expect(loadingEl.hasClass('claudian-hidden')).toBe(false);

      const clarificationEl = findByClass(contentEl, 'claudian-instruction-clarification-section');
      expect(clarificationEl.hasClass('claudian-hidden')).toBe(true);

      const confirmationEl = findByClass(contentEl, 'claudian-instruction-confirmation-section');
      expect(confirmationEl.hasClass('claudian-hidden')).toBe(true);
    });

    it('renders Abbrechen button in loading state', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      const buttons = findAllByClass(contentEl, 'claudian-instruction-btn');
      expect(buttons.length).toBe(1);
      expect(buttons[0].textContent).toBe('Abbrechen');
      expect(buttons[0].getAttribute('type')).toBe('button');
    });
  });

  describe('showClarification', () => {
    it('transitions to clarification state', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showClarification('What style do you want?');

      const loadingEl = findByClass(contentEl, 'claudian-instruction-loading');
      expect(loadingEl.hasClass('claudian-hidden')).toBe(true);

      const clarificationEl = findByClass(contentEl, 'claudian-instruction-clarification-section');
      expect(clarificationEl.hasClass('claudian-hidden')).toBe(false);
    });

    it('displays the clarification text', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showClarification('What format?');

      const clarificationTextEl = findByClass(contentEl, 'claudian-instruction-clarification');
      expect(clarificationTextEl.textContent).toBe('What format?');
    });

    it('renders German cancel and submit buttons', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showClarification('Question?');

      const buttons = findAllByClass(contentEl, 'claudian-instruction-btn');
      const buttonTexts = buttons.map((b: any) => b.textContent);
      expect(buttonTexts).toContain('Abbrechen');
      expect(buttonTexts).toContain('Antwort senden');
    });

    it('enables clarification submission only after an answer is entered', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showClarification('Question?');

      const submitBtn = findAllByClass(contentEl, 'claudian-instruction-accept-btn')[0];
      expect(submitBtn.disabled).toBe(true);
      expect(submitBtn.getAttribute('aria-disabled')).toBe('true');

      const responseTextarea = (modal as any).responseTextarea;
      responseTextarea.setValue('Mehr Details');
      const inputHandler = responseTextarea.inputEl.addEventListener.mock.calls
        .find(([event]: [string]) => event === 'input')?.[1];
      inputHandler();

      expect(submitBtn.disabled).toBe(false);
      expect(submitBtn.getAttribute('aria-disabled')).toBe('false');
    });
  });

  describe('showConfirmation', () => {
    it('transitions to confirmation state', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('Refined instruction text');

      const loadingEl = findByClass(contentEl, 'claudian-instruction-loading');
      expect(loadingEl.hasClass('claudian-hidden')).toBe(true);

      const confirmationEl = findByClass(contentEl, 'claudian-instruction-confirmation-section');
      expect(confirmationEl.hasClass('claudian-hidden')).toBe(false);
    });

    it('displays the refined instruction', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('The refined snippet');

      const refinedEl = findByClass(contentEl, 'claudian-instruction-refined');
      expect(refinedEl.textContent).toBe('The refined snippet');
    });

    it('renders German confirmation actions', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('instruction');

      const buttons = findAllByClass(contentEl, 'claudian-instruction-btn');
      const buttonTexts = buttons.map((b: any) => b.textContent);
      expect(buttonTexts).toContain('Abbrechen');
      expect(buttonTexts).toContain('Bearbeiten');
      expect(buttonTexts).toContain('Übernehmen');
    });
  });

  describe('accept callback', () => {
    it('calls onAccept with the refined instruction', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('raw', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('refined text');
      clickButton(contentEl, 'Übernehmen');

      expect(callbacks.onAccept).toHaveBeenCalledWith('refined text');
    });

    it('calls close when accepted', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('raw', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('refined');
      clickButton(contentEl, 'Übernehmen');

      expect((modal as any).close).toHaveBeenCalled();
    });

    it('prevents double-accept', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('raw', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('refined');
      clickButton(contentEl, 'Übernehmen');
      // Simulate second click - re-render buttons and try again
      modal.showConfirmation('refined');
      clickButton(contentEl, 'Übernehmen');

      expect(callbacks.onAccept).toHaveBeenCalledTimes(1);
    });
  });

  describe('reject callback', () => {
    it('calls onReject when Abbrechen is clicked', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      clickButton(contentEl, 'Abbrechen');

      expect(callbacks.onReject).toHaveBeenCalled();
    });

    it('calls close when rejected', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      clickButton(contentEl, 'Abbrechen');

      expect((modal as any).close).toHaveBeenCalled();
    });

    it('prevents double-reject', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      clickButton(contentEl, 'Abbrechen');
      // Reset buttons and try again
      modal.showClarification('q');
      clickButton(contentEl, 'Abbrechen');

      expect(callbacks.onReject).toHaveBeenCalledTimes(1);
    });
  });

  describe('onClose', () => {
    it('restores focus to the control that opened the modal', () => {
      const originalDocument = (globalThis as any).document;
      const trigger = { focus: jest.fn(), isConnected: true };
      (globalThis as any).document = { activeElement: trigger };

      try {
        const callbacks = createMockCallbacks();
        const modal = openModal('test', callbacks);

        InstructionModal.prototype.onClose.call(modal);

        expect(trigger.focus).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).document = originalDocument;
      }
    });

    it('calls onReject if not already resolved', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);

      InstructionModal.prototype.onClose.call(modal);

      expect(callbacks.onReject).toHaveBeenCalled();
    });

    it('does not call onReject if already resolved', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showConfirmation('refined');
      clickButton(contentEl, 'Übernehmen');

      InstructionModal.prototype.onClose.call(modal);

      expect(callbacks.onReject).not.toHaveBeenCalled();
    });
  });

  describe('showError', () => {
    it('closes the modal and marks as resolved', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);

      modal.showError('Something went wrong');

      expect((modal as any).close).toHaveBeenCalled();

      // onClose should not call onReject since resolved=true
      InstructionModal.prototype.onClose.call(modal);
      expect(callbacks.onReject).not.toHaveBeenCalled();
    });
  });

  describe('showClarificationLoading', () => {
    it('transitions back to loading state', () => {
      const callbacks = createMockCallbacks();
      const modal = openModal('test', callbacks);
      const contentEl = (modal as any).contentEl;

      modal.showClarification('question?');
      modal.showClarificationLoading();

      const loadingEl = findByClass(contentEl, 'claudian-instruction-loading');
      expect(loadingEl.hasClass('claudian-hidden')).toBe(false);

      const clarificationEl = findByClass(contentEl, 'claudian-instruction-clarification-section');
      expect(clarificationEl.hasClass('claudian-hidden')).toBe(true);
    });
  });
});
