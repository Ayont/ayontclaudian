import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import type ClaudianPlugin from '../../main';
import { confirm } from '../../shared/modals/ConfirmModal';
import type { ArtifactKind, ArtifactMeta, TrashedArtifact } from './ArtifactService';

const KIND_LABELS: Record<ArtifactKind, string> = {
  'diff-walkthrough': 'Diff-Rundgang',
  dashboard: 'Dashboard',
  comparison: 'Vergleich',
  'interactive-controls': 'Interaktive Steuerung',
  timeline: 'Zeitleiste',
  'triage-board': 'Triage-Board',
  custom: 'Individuell',
};

interface PendingArtifactDeletion {
  artifact: ArtifactMeta;
  snapshot: TrashedArtifact;
  errorMessage?: string;
}

/** Browses, opens, safely trashes, and restores generated artifacts. */
export class ArtifactGalleryModal extends Modal {
  private artifacts: ArtifactMeta[] = [];
  private gridEl: HTMLElement | null = null;
  private feedbackEl: HTMLElement | null = null;
  private pendingDeletions: PendingArtifactDeletion[] = [];

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-artifact-gallery-modal');
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-artifact-gallery-header' });
    const headerIcon = header.createSpan({ cls: 'claudian-artifact-gallery-icon' });
    headerIcon.setAttribute('aria-hidden', 'true');
    setIcon(headerIcon, 'layout-dashboard');
    const heading = header.createEl('h2', { text: 'Artifact-Galerie' });
    heading.id = 'claudian-artifact-gallery-title';
    this.modalEl.setAttribute('aria-labelledby', heading.id);

    contentEl.createEl('p', {
      cls: 'claudian-artifact-gallery-description',
      text: 'Interaktive Ergebnisse öffnen, verwalten und sicher wiederherstellen.',
    });

    this.feedbackEl = contentEl.createDiv({ cls: 'claudian-artifact-gallery-feedback claudian-hidden' });
    this.feedbackEl.setAttribute('aria-live', 'polite');
    this.feedbackEl.setAttribute('aria-atomic', 'true');

    this.gridEl = contentEl.createDiv({ cls: 'claudian-artifact-gallery-grid' });
    await this.loadArtifacts();
  }

  onClose(): void {
    this.gridEl = null;
    this.feedbackEl = null;
    this.pendingDeletions = [];
    this.contentEl.empty();
  }

  private async loadArtifacts(): Promise<void> {
    if (!this.gridEl) return;
    this.gridEl.empty();
    this.gridEl.setAttribute('aria-busy', 'true');
    this.gridEl.createEl('p', {
      cls: 'claudian-artifact-gallery-empty',
      text: 'Artefakte werden geladen …',
    });

    try {
      this.artifacts = await this.plugin.artifactService.listArtifacts();
      this.clearFeedback();
      this.renderGrid();
    } catch (error) {
      this.artifacts = [];
      this.renderLoadError(error);
    } finally {
      this.gridEl?.setAttribute('aria-busy', 'false');
    }
  }

  private renderGrid(): void {
    if (!this.gridEl) return;
    this.gridEl.empty();

    if (this.artifacts.length === 0) {
      this.gridEl.createEl('p', {
        cls: 'claudian-artifact-gallery-empty',
        text: 'Noch keine Artefakte vorhanden. Erstelle eines mit „/artifact <Beschreibung>“ im Chat.',
      });
      return;
    }

    this.artifacts.forEach((artifact, index) => this.renderArtifactCard(artifact, index));
  }

  private renderArtifactCard(artifact: ArtifactMeta, index: number): void {
    if (!this.gridEl) return;
    const card = this.gridEl.createEl('article', { cls: 'claudian-artifact-card' });
    const titleId = `claudian-artifact-title-${index}`;
    card.setAttribute('aria-labelledby', titleId);

    const summary = card.createDiv({ cls: 'claudian-artifact-card-summary' });
    const iconEl = summary.createSpan({ cls: 'claudian-artifact-card-icon', text: artifact.icon });
    iconEl.setAttribute('aria-hidden', 'true');

    const body = summary.createDiv({ cls: 'claudian-artifact-card-body' });
    const titleEl = body.createEl('h3', { cls: 'claudian-artifact-card-title', text: artifact.title });
    titleEl.id = titleId;
    const meta = body.createDiv({ cls: 'claudian-artifact-card-meta' });
    meta.createSpan({ text: KIND_LABELS[artifact.kind] });
    meta.createSpan({ text: `Version ${artifact.version}` });
    meta.createSpan({ text: this.relativeTime(artifact.updatedAt) });

    const actions = card.createDiv({ cls: 'claudian-artifact-card-actions' });
    const openBtn = this.createActionButton(
      actions,
      'Öffnen',
      'external-link',
      `${artifact.title} im Browser öffnen`,
    );
    openBtn.addEventListener('click', () => {
      void this.openArtifact(artifact, openBtn);
    });

    const deleteBtn = this.createActionButton(
      actions,
      'In Papierkorb',
      'trash-2',
      `${artifact.title} in den Papierkorb verschieben`,
      true,
    );
    deleteBtn.addEventListener('click', () => {
      void this.confirmAndTrashArtifact(artifact, deleteBtn);
    });
  }

  private createActionButton(
    parent: HTMLElement,
    text: string,
    icon: string,
    ariaLabel: string,
    danger = false,
  ): HTMLButtonElement {
    const button = parent.createEl('button', {
      cls: `claudian-artifact-card-btn${danger ? ' claudian-artifact-card-btn--danger' : ''}`,
      text,
      attr: {
        type: 'button',
        'aria-label': ariaLabel,
      },
    });
    const iconEl = button.createSpan({ cls: 'claudian-artifact-card-btn-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setIcon(iconEl, icon);
    return button;
  }

  private async openArtifact(artifact: ArtifactMeta, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      await this.plugin.artifactService.openInBrowser(artifact.filePath);
    } catch (error) {
      this.showError(`„${artifact.title}“ konnte nicht geöffnet werden`, error);
    } finally {
      button.disabled = false;
    }
  }

  private async confirmAndTrashArtifact(
    artifact: ArtifactMeta,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (button.disabled) return;
    button.disabled = true;
    let confirmed: boolean;
    try {
      confirmed = await confirm(
        this.app,
        `„${artifact.title}“ wird in den Obsidian-Papierkorb verschoben und kann wiederhergestellt werden.`,
        'In Papierkorb',
      );
    } catch (error) {
      this.showError('Die Löschbestätigung konnte nicht geöffnet werden', error);
      button.disabled = false;
      return;
    }
    if (!confirmed) {
      button.disabled = false;
      return;
    }

    try {
      const snapshot = await this.plugin.artifactService.deleteArtifact(artifact.filePath);
      this.pendingDeletions = [
        ...this.pendingDeletions.filter((pending) => pending.snapshot.filePath !== snapshot.filePath),
        { artifact, snapshot },
      ];
      this.artifacts = this.artifacts.filter((candidate) => candidate.filePath !== artifact.filePath);
      this.renderGrid();
      this.renderUndoFeedback();
      new Notice(`„${artifact.title}“ wurde in den Papierkorb verschoben.`);
    } catch (error) {
      this.showError(`„${artifact.title}“ konnte nicht in den Papierkorb verschoben werden`, error);
      button.disabled = false;
    }
  }

  private renderUndoFeedback(): void {
    if (!this.feedbackEl || this.pendingDeletions.length === 0) return;
    this.feedbackEl.empty();
    this.feedbackEl.removeClass('claudian-hidden');
    this.feedbackEl.toggleClass(
      'claudian-artifact-gallery-feedback--error',
      this.pendingDeletions.some((pending) => Boolean(pending.errorMessage)),
    );
    this.feedbackEl.removeAttribute('role');

    const list = this.feedbackEl.createDiv({ cls: 'claudian-artifact-gallery-feedback-list' });
    for (const pending of this.pendingDeletions) {
      const item = list.createDiv({ cls: 'claudian-artifact-gallery-feedback-item' });
      if (pending.errorMessage) item.setAttribute('role', 'alert');
      item.createSpan({
        text: pending.errorMessage ?? `„${pending.artifact.title}“ liegt im Papierkorb.`,
      });
      const undoBtn = item.createEl('button', {
        cls: 'claudian-artifact-gallery-undo',
        text: pending.errorMessage ? 'Wiederherstellung erneut versuchen' : 'Rückgängig',
        attr: {
          type: 'button',
          'aria-label': `${pending.artifact.title} wiederherstellen`,
        },
      });
      undoBtn.addEventListener('click', () => {
        void this.restorePendingArtifact(pending, undoBtn);
      });
    }
  }

  private async restorePendingArtifact(
    pending: PendingArtifactDeletion,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (!this.pendingDeletions.includes(pending)) return;
    button.disabled = true;

    try {
      await this.plugin.artifactService.restoreArtifact(pending.snapshot);
      this.artifacts = [pending.artifact, ...this.artifacts]
        .sort((a, b) => b.updatedAt - a.updatedAt);
      this.pendingDeletions = this.pendingDeletions.filter((candidate) => candidate !== pending);
      this.renderGrid();
      if (this.pendingDeletions.length > 0) {
        this.renderUndoFeedback();
      } else {
        this.showStatus(`„${pending.artifact.title}“ wurde wiederhergestellt.`);
      }
      new Notice(`„${pending.artifact.title}“ wurde wiederhergestellt.`);
    } catch (error) {
      const message = `„${pending.artifact.title}“ konnte nicht wiederhergestellt werden: ${this.errorMessage(error)}`;
      pending.errorMessage = message;
      this.renderUndoFeedback();
      new Notice(message);
    }
  }

  private renderLoadError(error: unknown): void {
    if (!this.gridEl) return;
    this.gridEl.empty();
    const state = this.gridEl.createDiv({ cls: 'claudian-artifact-gallery-error' });
    state.setAttribute('role', 'alert');
    state.createEl('p', { text: `Artefakte konnten nicht geladen werden: ${this.errorMessage(error)}` });
    const retry = state.createEl('button', {
      text: 'Erneut versuchen',
      attr: { type: 'button' },
    });
    retry.addEventListener('click', () => {
      void this.loadArtifacts();
    });
  }

  private showError(context: string, error: unknown): void {
    if (!this.feedbackEl) return;
    const message = `${context}: ${this.errorMessage(error)}`;
    this.feedbackEl.empty();
    this.feedbackEl.removeClass('claudian-hidden');
    this.feedbackEl.addClass('claudian-artifact-gallery-feedback--error');
    this.feedbackEl.setAttribute('role', 'alert');
    this.feedbackEl.createSpan({ text: message });
    new Notice(message);
  }

  private showStatus(message: string): void {
    if (!this.feedbackEl) return;
    this.feedbackEl.empty();
    this.feedbackEl.removeClass('claudian-hidden');
    this.feedbackEl.removeClass('claudian-artifact-gallery-feedback--error');
    this.feedbackEl.setAttribute('role', 'status');
    this.feedbackEl.createSpan({ text: message });
  }

  private clearFeedback(): void {
    this.feedbackEl?.empty();
    this.feedbackEl?.addClass('claudian-hidden');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message.trim()
      ? error.message
      : 'Unbekannter Fehler';
  }

  private relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (seconds < 60) return 'gerade eben';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `vor ${minutes} Min.`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.round(hours / 24);
    return `vor ${days} Tag${days === 1 ? '' : 'en'}`;
  }
}
