import { Modal, Notice, setIcon } from 'obsidian';

import type ClaudianPlugin from '../../main';
import type { ArtifactMeta } from './ArtifactService';

/**
 * Artifact Gallery modal — browses all artifacts, opens them in browser,
 * and allows deletion. Adapted from Claude Code's artifact gallery on
 * claude.ai/code/artifacts.
 */
export class ArtifactGalleryModal extends Modal {
  private artifacts: ArtifactMeta[] = [];
  private gridEl: HTMLElement | null = null;

  constructor(app: import('obsidian').App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-artifact-gallery-modal');
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-artifact-gallery-header' });
    setIcon(header.createSpan({ cls: 'claudian-artifact-gallery-icon' }), 'layout-dashboard');
    header.createEl('h2', { text: 'Artifact Gallery' });

    this.gridEl = contentEl.createDiv({ cls: 'claudian-artifact-gallery-grid' });

    const loading = this.gridEl.createEl('p', { cls: 'claudian-artifact-gallery-empty', text: 'Loading...' });
    try {
      this.artifacts = await this.plugin.artifactService.listArtifacts();
    } catch {
      this.artifacts = [];
    }
    loading.remove();
    this.renderGrid();
  }

  private renderGrid(): void {
    if (!this.gridEl) return;
    this.gridEl.empty();

    if (this.artifacts.length === 0) {
      this.gridEl.createEl('p', {
        cls: 'claudian-artifact-gallery-empty',
        text: 'No artifacts yet. Ask Claudian to create one: "Make an artifact that..."',
      });
      return;
    }

    for (const artifact of this.artifacts) {
      const card = this.gridEl.createDiv({ cls: 'claudian-artifact-card' });
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const iconEl = card.createSpan({ cls: 'claudian-artifact-card-icon', text: artifact.icon });
      void iconEl;

      const body = card.createDiv({ cls: 'claudian-artifact-card-body' });
      body.createEl('span', { cls: 'claudian-artifact-card-title', text: artifact.title });
      const meta = body.createDiv({ cls: 'claudian-artifact-card-meta' });
      meta.createSpan({ text: `v${artifact.version}` });
      meta.createSpan({ text: this.relativeTime(artifact.updatedAt) });

      const actions = card.createDiv({ cls: 'claudian-artifact-card-actions' });
      const openBtn = actions.createEl('button', { cls: 'claudian-artifact-card-btn' });
      setIcon(openBtn.createSpan(), 'external-link');
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.plugin.artifactService.openInBrowser(artifact.filePath);
      });

      const deleteBtn = actions.createEl('button', { cls: 'claudian-artifact-card-btn claudian-artifact-card-btn--danger' });
      setIcon(deleteBtn.createSpan(), 'trash-2');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.plugin.artifactService.deleteArtifact(artifact.filePath);
        new Notice('Artifact deleted.');
        this.artifacts = await this.plugin.artifactService.listArtifacts();
        this.renderGrid();
      });

      card.addEventListener('click', () => {
        void this.plugin.artifactService.openInBrowser(artifact.filePath);
      });
    }
  }

  private relativeTime(ts: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }
}
