/**
 * Claudian - Instruction modal
 *
 * Unified modal that handles all instruction mode states:
 * - Loading (initial processing)
 * - Clarification (agent asks question)
 * - Confirmation (final instruction review)
 */

import type { App } from 'obsidian';
import { Modal, TextAreaComponent } from 'obsidian';

export type InstructionDecision = 'accept' | 'reject';

type ModalState = 'loading' | 'clarification' | 'confirmation';

export interface InstructionModalCallbacks {
  onAccept: (finalInstruction: string) => void;
  onReject: () => void;
  onClarificationSubmit: (response: string) => Promise<void>;
}

export class InstructionModal extends Modal {
  private rawInstruction: string;
  private callbacks: InstructionModalCallbacks;
  private state: ModalState = 'loading';
  private resolved = false;
  private previouslyFocusedEl: HTMLElement | null = null;

  // UI elements
  private contentSectionEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private clarificationEl: HTMLElement | null = null;
  private confirmationEl: HTMLElement | null = null;
  private buttonsEl: HTMLElement | null = null;

  // Clarification state
  private clarificationTextEl: HTMLElement | null = null;
  private responseTextarea: TextAreaComponent | null = null;
  private clarificationSubmitBtnEl: HTMLButtonElement | null = null;
  private isSubmitting = false;

  // Confirmation state
  private refinedInstruction: string = '';
  private editTextarea: TextAreaComponent | null = null;
  private isEditing = false;
  private refinedDisplayEl: HTMLElement | null = null;
  private editContainerEl: HTMLElement | null = null;
  private editBtnEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    rawInstruction: string,
    callbacks: InstructionModalCallbacks
  ) {
    super(app);
    this.rawInstruction = rawInstruction;
    this.callbacks = callbacks;
  }

  onOpen() {
    const { contentEl } = this;
    const activeElement = contentEl.ownerDocument?.activeElement;
    this.previouslyFocusedEl = activeElement && typeof (activeElement as HTMLElement).focus === 'function'
      ? activeElement as HTMLElement
      : null;
    contentEl.addClass('claudian-instruction-modal');
    this.setTitle('Eigene Anweisung hinzufügen');

    // User input section (always visible)
    const inputSection = contentEl.createDiv({ cls: 'claudian-instruction-section' });
    const inputLabel = inputSection.createDiv({ cls: 'claudian-instruction-label' });
    inputLabel.setText('Deine Eingabe:');
    const inputText = inputSection.createDiv({ cls: 'claudian-instruction-original' });
    inputText.setText(this.rawInstruction);

    // Main content section (changes based on state)
    this.contentSectionEl = contentEl.createDiv({ cls: 'claudian-instruction-content-section' });

    // Loading state
    this.loadingEl = this.contentSectionEl.createDiv({ cls: 'claudian-instruction-loading' });
    this.loadingEl.setAttribute('role', 'status');
    this.loadingEl.setAttribute('aria-live', 'polite');
    this.loadingEl.setAttribute('aria-atomic', 'true');
    const spinnerEl = this.loadingEl.createDiv({ cls: 'claudian-instruction-spinner' });
    spinnerEl.setAttribute('aria-hidden', 'true');
    this.loadingEl.createSpan({ text: 'Anweisung wird verarbeitet …' });

    // Clarification state (hidden initially)
    this.clarificationEl = this.contentSectionEl.createDiv({ cls: 'claudian-instruction-clarification-section' });
    this.clarificationEl.addClass('claudian-hidden');
    this.clarificationEl.setAttribute('role', 'region');
    this.clarificationEl.setAttribute('aria-label', 'Rückfrage');
    this.clarificationTextEl = this.clarificationEl.createDiv({ cls: 'claudian-instruction-clarification' });

    const responseSection = this.clarificationEl.createDiv({ cls: 'claudian-instruction-section' });
    const responseLabel = responseSection.createDiv({ cls: 'claudian-instruction-label' });
    responseLabel.setText('Deine Antwort:');

    this.responseTextarea = new TextAreaComponent(responseSection);
    this.responseTextarea.inputEl.addClass('claudian-instruction-response-textarea');
    this.responseTextarea.inputEl.rows = 3;
    this.responseTextarea.inputEl.placeholder = 'Weitere Details angeben …';
    this.responseTextarea.inputEl.ariaLabel = 'Antwort auf die Rückfrage';

    this.responseTextarea.inputEl.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.isSubmitting) {
        e.preventDefault();
        void this.submitClarification();
      }
    });
    this.responseTextarea.inputEl.addEventListener('input', () => {
      this.updateClarificationSubmitState();
    });

    // Confirmation state (hidden initially)
    this.confirmationEl = this.contentSectionEl.createDiv({ cls: 'claudian-instruction-confirmation-section' });
    this.confirmationEl.addClass('claudian-hidden');
    this.confirmationEl.setAttribute('role', 'region');
    this.confirmationEl.setAttribute('aria-label', 'Überarbeitete Anweisung');

    // Refined instruction display/edit
    const refinedSection = this.confirmationEl.createDiv({ cls: 'claudian-instruction-section' });
    const refinedLabel = refinedSection.createDiv({ cls: 'claudian-instruction-label' });
    refinedLabel.setText('Überarbeitete Anweisung:');

    this.refinedDisplayEl = refinedSection.createDiv({ cls: 'claudian-instruction-refined' });
    this.editContainerEl = refinedSection.createDiv({ cls: 'claudian-instruction-edit-container' });
    this.editContainerEl.addClass('claudian-hidden');

    this.editTextarea = new TextAreaComponent(this.editContainerEl);
    this.editTextarea.inputEl.addClass('claudian-instruction-edit-textarea');
    this.editTextarea.inputEl.rows = 4;
    this.editTextarea.inputEl.ariaLabel = 'Überarbeitete Anweisung bearbeiten';

    // Buttons (changes based on state)
    this.buttonsEl = contentEl.createDiv({ cls: 'claudian-instruction-buttons' });
    this.updateButtons();

    this.showState('loading');
  }

  showClarification(clarification: string) {
    if (this.clarificationTextEl) {
      this.clarificationTextEl.setText(clarification);
    }
    if (this.responseTextarea) {
      this.responseTextarea.setValue('');
    }
    this.isSubmitting = false;
    this.showState('clarification');
    this.responseTextarea?.inputEl.focus();
  }

  showConfirmation(refinedInstruction: string) {
    this.refinedInstruction = refinedInstruction;

    if (this.refinedDisplayEl) {
      this.refinedDisplayEl.setText(refinedInstruction);
    }
    if (this.editTextarea) {
      this.editTextarea.setValue(refinedInstruction);
    }

    this.showState('confirmation');
  }

  showError(error: string) {
    // Just close - the error notice will be shown by caller
    this.resolved = true;
    this.close();
  }

  showClarificationLoading() {
    this.isSubmitting = true;
    if (this.loadingEl) {
      this.loadingEl.querySelector('.claudian-instruction-spinner');
      const text = this.loadingEl.querySelector('span');
      if (text) text.textContent = 'Antwort wird verarbeitet …';
    }
    this.showState('loading');
  }

  private showState(state: ModalState) {
    this.state = state;

    if (this.loadingEl) {
      this.loadingEl.toggleClass('claudian-hidden', state !== 'loading');
    }
    if (this.clarificationEl) {
      this.clarificationEl.toggleClass('claudian-hidden', state !== 'clarification');
    }
    if (this.confirmationEl) {
      this.confirmationEl.toggleClass('claudian-hidden', state !== 'confirmation');
    }
    this.contentSectionEl?.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

    this.updateButtons();
  }

  private updateButtons() {
    if (!this.buttonsEl) return;
    this.buttonsEl.empty();
    this.clarificationSubmitBtnEl = null;
    this.editBtnEl = null;

    const cancelBtn = this.buttonsEl.createEl('button', {
      text: 'Abbrechen',
      cls: 'claudian-instruction-btn claudian-instruction-reject-btn',
      attr: { type: 'button', 'aria-label': 'Anweisung abbrechen' }
    });
    cancelBtn.addEventListener('click', () => this.handleReject());

    if (this.state === 'clarification') {
      this.clarificationSubmitBtnEl = this.buttonsEl.createEl('button', {
        text: 'Antwort senden',
        cls: 'claudian-instruction-btn claudian-instruction-accept-btn',
        attr: { type: 'button', 'aria-label': 'Antwort senden' }
      });
      this.clarificationSubmitBtnEl.addEventListener('click', () => {
        void this.submitClarification();
      });
      this.updateClarificationSubmitState();
    } else if (this.state === 'confirmation') {
      this.editBtnEl = this.buttonsEl.createEl('button', {
        text: 'Bearbeiten',
        cls: 'claudian-instruction-btn claudian-instruction-edit-btn',
        attr: { type: 'button', 'aria-label': 'Anweisung bearbeiten' }
      });
      this.editBtnEl.addEventListener('click', () => this.toggleEdit());

      const acceptBtn = this.buttonsEl.createEl('button', {
        text: 'Übernehmen',
        cls: 'claudian-instruction-btn claudian-instruction-accept-btn',
        attr: { type: 'button', 'aria-label': 'Anweisung übernehmen' }
      });
      acceptBtn.addEventListener('click', () => this.handleAccept());
      acceptBtn.focus();
    }
  }

  private updateClarificationSubmitState(): void {
    if (!this.clarificationSubmitBtnEl) return;
    const isDisabled = this.isSubmitting || !this.responseTextarea?.getValue().trim();
    this.clarificationSubmitBtnEl.disabled = isDisabled;
    this.clarificationSubmitBtnEl.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
  }

  private async submitClarification() {
    const response = this.responseTextarea?.getValue().trim();
    if (!response || this.isSubmitting) return;

    this.showClarificationLoading();

    try {
      await this.callbacks.onClarificationSubmit(response);
    } catch {
      // On error, go back to clarification state
      this.isSubmitting = false;
      this.showState('clarification');
      this.responseTextarea?.inputEl.focus();
    }
  }

  private toggleEdit() {
    this.isEditing = !this.isEditing;

    if (this.isEditing) {
      this.refinedDisplayEl?.addClass('claudian-hidden');
      this.editContainerEl?.removeClass('claudian-hidden');
      if (this.editBtnEl) {
        this.editBtnEl.setText('Vorschau');
        this.editBtnEl.setAttribute('aria-label', 'Vorschau anzeigen');
      }
      this.editTextarea?.inputEl.focus();
    } else {
      const edited = this.editTextarea?.getValue() || this.refinedInstruction;
      this.refinedInstruction = edited;
      if (this.refinedDisplayEl) {
        this.refinedDisplayEl.setText(edited);
        this.refinedDisplayEl.removeClass('claudian-hidden');
      }
      this.editContainerEl?.addClass('claudian-hidden');
      if (this.editBtnEl) {
        this.editBtnEl.setText('Bearbeiten');
        this.editBtnEl.setAttribute('aria-label', 'Anweisung bearbeiten');
      }
    }
  }

  private handleAccept() {
    if (this.resolved) return;
    this.resolved = true;

    const finalInstruction = this.isEditing
      ? (this.editTextarea?.getValue() || this.refinedInstruction)
      : this.refinedInstruction;

    this.callbacks.onAccept(finalInstruction);
    this.close();
  }

  private handleReject() {
    if (this.resolved) return;
    this.resolved = true;
    this.callbacks.onReject();
    this.close();
  }

  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.callbacks.onReject();
    }
    this.contentEl.empty();
    if (this.previouslyFocusedEl && this.previouslyFocusedEl.isConnected !== false) {
      this.previouslyFocusedEl.focus();
    }
    this.previouslyFocusedEl = null;
  }
}
