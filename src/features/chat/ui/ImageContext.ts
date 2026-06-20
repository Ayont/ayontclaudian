import { Notice, setIcon } from 'obsidian';
import * as path from 'path';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';
import type { ImageStagingService } from '../services/ImageStagingService';
import { attachmentTypeMeta, formatFileSize } from './file-drop/attachmentMeta';
import {
  formatDroppedFileBlock,
  isTextLikeFile,
  MAX_DROPPED_TEXT_SIZE,
} from './file-drop/droppedTextFile';

/** A non-image file staged into the vault and shown as a preview chip. */
interface StagedAttachment {
  id: string;
  name: string;
  relPath: string;
  size: number;
}

const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
  /**
   * Stages a dropped non-image/non-text file (PDF, doc, binary, …) into the
   * vault so any provider's agent can read it, returning the vault-relative path
   * (or null on failure). Lets PDFs & co work across ALL models via an @path
   * mention. Optional: when absent, such files are reported as unsupported.
   */
  stageVaultAttachment?: (file: File) => Promise<string | null>;
  /**
   * Returns the id of the conversation the input currently belongs to, or null
   * for a not-yet-persisted "new chat". Used to scope staged draft images PER
   * conversation so a restart restores only the active chat's images — never a
   * global dump of every past chat's attachments.
   */
  getConversationId?: () => string | null;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private previewContainerEl: HTMLElement;
  private imagePreviewEl: HTMLElement;
  private attachmentPreviewEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  /** Ids of images currently being persisted to staging (shows a spinner). */
  private uploadingImageIds: Set<string> = new Set();
  /** Non-image files staged into the vault, shown as preview chips. */
  private stagedAttachments: Map<string, StagedAttachment> = new Map();
  /** Placeholder chips for in-flight file uploads, keyed by a temp id. */
  private pendingUploads: Map<string, string> = new Map();
  private enabled = true;
  private stagingService: ImageStagingService | null;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    stagingService?: ImageStagingService
  ) {
    this.containerEl = containerEl;
    this.previewContainerEl = previewContainerEl ?? containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    this.stagingService = stagingService ?? null;

    // Create image preview in previewContainerEl, before file indicator if present
    const fileIndicator = this.previewContainerEl.querySelector('.claudian-file-indicator');
    this.imagePreviewEl = this.previewContainerEl.createDiv({ cls: 'claudian-image-preview' });
    if (fileIndicator && fileIndicator.parentElement === this.previewContainerEl) {
      this.previewContainerEl.insertBefore(this.imagePreviewEl, fileIndicator);
    }

    // Attachment preview (PDF / video / generic file chips) sits between the
    // image preview and the file indicator so all staged attachments read as
    // one row above the input.
    this.attachmentPreviewEl = this.previewContainerEl.createDiv({ cls: 'claudian-attachment-preview claudian-hidden' });
    if (fileIndicator && fileIndicator.parentElement === this.previewContainerEl) {
      this.previewContainerEl.insertBefore(this.attachmentPreviewEl, fileIndicator);
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
    void this.restoreFromStaging();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages(clearStaging = false) {
    if (clearStaging && this.stagingService) {
      for (const id of this.attachedImages.keys()) {
        void this.stagingService.deleteImage(id).catch(() => {});
      }
    }
    this.attachedImages.clear();
    this.uploadingImageIds.clear();
    this.stagedAttachments.clear();
    this.pendingUploads.clear();
    this.updateImagePreview();
    this.updateAttachmentPreview();
    this.callbacks.onImagesChanged();
  }

  /**
   * Restores staged draft images for the CURRENT conversation only. Scoped by
   * conversation id so a restart never dumps every past chat's images at once.
   */
  private async restoreFromStaging(): Promise<void> {
    if (!this.stagingService) return;
    try {
      const conversationId = this.callbacks.getConversationId?.() ?? null;
      const entries = await this.stagingService.listImagesForConversation(conversationId);
      for (const entry of entries) {
        const loaded = await this.stagingService.loadImage(entry.id);
        if (loaded) {
          this.attachedImages.set(loaded.id, loaded);
        }
      }
      if (this.attachedImages.size > 0) {
        this.updateImagePreview();
        this.callbacks.onImagesChanged();
      }
    } catch {
      // Best-effort restore.
    }
  }

  /**
   * Switches the input's attachments to a (possibly different) conversation:
   * drops the in-memory images of the previous conversation (their data is
   * already persisted in staging) and restores the target conversation's
   * staged draft images. Call this after the active conversation id changes.
   */
  async reloadForConversation(): Promise<void> {
    this.attachedImages.clear();
    this.uploadingImageIds.clear();
    this.stagedAttachments.clear();
    this.pendingUploads.clear();
    this.updateImagePreview();
    this.updateAttachmentPreview();
    await this.restoreFromStaging();
    // Always notify so context-row visibility reflects the (possibly empty) set.
    this.callbacks.onImagesChanged();
  }

  /**
   * Re-tags the currently attached draft images to a freshly created
   * conversation id. Called when a "new chat" (null scope) is lazily persisted
   * so unsent drafts stay bound to the right conversation across restarts.
   */
  reassignToConversation(conversationId: string | null): void {
    if (!this.stagingService || this.attachedImages.size === 0) return;
    const ids = Array.from(this.attachedImages.keys());
    void this.stagingService.reassignConversation(ids, conversationId).catch(() => {});
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = inputWrapper.createDiv({ cls: 'claudian-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'claudian-drop-content' });
    const ownerDocument = inputWrapper.ownerDocument ?? window.document;
    const svg = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const pathEl = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '3');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');
    svg.appendChild(pathEl);
    svg.appendChild(polyline);
    svg.appendChild(line);
    dropContent.appendChild(svg);
    dropContent.createSpan({ text: 'Drop image, text or file here' });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    dropZone.addEventListener('drop', (e) => {
      void this.handleDrop(e);
    });
  }

  private handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.addClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    let unsupported = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      } else if (isTextLikeFile(file.name, file.type)) {
        await this.insertDroppedTextFile(file);
      } else if (this.callbacks.stageVaultAttachment) {
        // PDF / doc / binary: stage into the vault and @-mention it so ANY
        // provider's agent can read it (all run with the vault as workspace).
        const ok = await this.stageAndMentionFile(file);
        if (!ok) unsupported++;
      } else {
        unsupported++;
      }
    }

    if (unsupported > 0) {
      new Notice(
        `${unsupported} Datei(en) übersprungen — konnten nicht angehängt werden.`,
      );
    }
  }

  /**
   * Stages a non-image/non-text dropped file into the vault and inserts an
   * `@path` mention into the input, so every provider can read it. Returns false
   * when staging is unavailable or fails.
   */
  private async stageAndMentionFile(file: File): Promise<boolean> {
    if (!this.callbacks.stageVaultAttachment) return false;

    // Show an immediate "uploading" chip so the staging is visible.
    const pendingId = `att-${this.generateId()}`;
    this.pendingUploads.set(pendingId, file.name);
    this.updateAttachmentPreview();

    let relPath: string | null;
    try {
      relPath = await this.callbacks.stageVaultAttachment(file);
    } catch {
      relPath = null;
    }

    this.pendingUploads.delete(pendingId);

    if (!relPath) {
      this.updateAttachmentPreview();
      new Notice(`„${file.name}" konnte nicht angehängt werden.`);
      return false;
    }

    // Track the staged attachment as a removable preview chip and inject the
    // @path mention so any provider's agent can actually read the file.
    this.stagedAttachments.set(pendingId, { id: pendingId, name: file.name, relPath, size: file.size });
    this.insertIntoInput(`\n\n@${relPath}\n`);
    this.updateAttachmentPreview();
    new Notice(`„${file.name}" angehängt.`);
    return true;
  }

  /** Inserts text into the chat input at the caret (or appends), then refocuses. */
  private insertIntoInput(text: string): void {
    const el = this.inputEl;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    const caret = start + text.length;
    el.setSelectionRange?.(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  }

  /**
   * Inlines a dropped text-like file into the chat input as a fenced code block.
   * Backwards compatible: the message stays a plain string. Inserted at the
   * caret (or appended) so the user can keep typing around it.
   */
  private async insertDroppedTextFile(file: File): Promise<void> {
    if (file.size > MAX_DROPPED_TEXT_SIZE) {
      new Notice(
        `„${file.name}" ist zu groß zum Einfügen (max ${this.formatSize(MAX_DROPPED_TEXT_SIZE)}).`,
      );
      return;
    }

    let content: string;
    try {
      content = await file.text();
    } catch {
      new Notice(`„${file.name}" konnte nicht gelesen werden.`);
      return;
    }

    this.insertIntoInput(formatDroppedFileBlock(file.name, content));
    new Notice(`„${file.name}" als Text eingefügt.`);
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, 'paste');
          }
          return;
        }
      }
      })();
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (!this.enabled) {
      new Notice('Image attachments are not supported by this provider.');
      return false;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError('Unsupported image type.');
      return false;
    }

    try {
      const base64 = await this.fileToBase64(file);

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType,
        data: base64,
        size: file.size,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      // Persist to staging (scoped to the current conversation) so the image
      // survives restarts without leaking into other chats. While the write is
      // in flight the chip shows an "uploading" state.
      const conversationId = this.callbacks.getConversationId?.() ?? null;
      if (this.stagingService) {
        this.uploadingImageIds.add(attachment.id);
        void this.stagingService.saveImage(attachment, conversationId)
          .catch(() => {
            // Best-effort staging; the image is still in memory.
          })
          .finally(() => {
            this.uploadingImageIds.delete(attachment.id);
            this.updateImagePreview();
          });
      }
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
      return true;
    } catch (error) {
      this.notifyImageError('Failed to attach image.', error);
      return false;
    }
  }

  private async fileToBase64(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return buffer.toString('base64');
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    this.imagePreviewEl.empty();

    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.removeClass('claudian-visible-flex');
      this.imagePreviewEl.addClass('claudian-hidden');
      return;
    }

    this.imagePreviewEl.addClass('claudian-visible-flex');
    this.imagePreviewEl.removeClass('claudian-hidden');

    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
  }

  private renderImagePreview(id: string, image: ImageAttachment) {
    const previewEl = this.imagePreviewEl.createDiv({ cls: 'claudian-image-chip' });
    const isUploading = this.uploadingImageIds.has(id);
    if (isUploading) previewEl.addClass('claudian-attachment-chip--uploading');

    const thumbEl = previewEl.createDiv({ cls: 'claudian-image-thumb' });
    thumbEl.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });
    if (isUploading) {
      thumbEl.createDiv({ cls: 'claudian-attachment-spinner' });
    }

    const infoEl = previewEl.createDiv({ cls: 'claudian-image-info' });
    const nameEl = infoEl.createSpan({ cls: 'claudian-image-name' });
    nameEl.setText(this.truncateName(image.name, 20));
    nameEl.setAttribute('title', image.name);

    const sizeEl = infoEl.createSpan({ cls: 'claudian-image-size' });
    sizeEl.setText(this.formatSize(image.size));

    const removeEl = previewEl.createSpan({ cls: 'claudian-image-remove' });
    removeEl.setText('\u00D7');
    removeEl.setAttribute('aria-label', 'Remove image');

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      void this.stagingService?.deleteImage(id).catch(() => {});
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });

    thumbEl.addEventListener('click', () => {
      this.showFullImage(image);
    });
  }

  // ============================================
  // Private: Attachment (non-image file) preview
  // ============================================

  /** Re-renders the staged file chips (PDF / video / docs / generic + uploads). */
  private updateAttachmentPreview(): void {
    this.attachmentPreviewEl.empty();

    const total = this.stagedAttachments.size + this.pendingUploads.size;
    if (total === 0) {
      this.attachmentPreviewEl.removeClass('claudian-visible-flex');
      this.attachmentPreviewEl.addClass('claudian-hidden');
      return;
    }

    this.attachmentPreviewEl.addClass('claudian-visible-flex');
    this.attachmentPreviewEl.removeClass('claudian-hidden');

    // In-flight uploads first (spinner chips).
    for (const [pendingId, name] of this.pendingUploads) {
      this.renderUploadingChip(pendingId, name);
    }
    for (const [id, att] of this.stagedAttachments) {
      this.renderAttachmentChip(id, att);
    }
  }

  /** A placeholder chip with a spinner shown while a file is being staged. */
  private renderUploadingChip(_pendingId: string, name: string): void {
    const meta = attachmentTypeMeta(name);
    const chip = this.attachmentPreviewEl.createDiv({
      cls: `claudian-attachment-chip claudian-attachment-chip--${meta.typeClass} claudian-attachment-chip--uploading`,
    });
    const iconWrap = chip.createDiv({ cls: 'claudian-attachment-icon' });
    iconWrap.createDiv({ cls: 'claudian-attachment-spinner' });

    const infoEl = chip.createDiv({ cls: 'claudian-attachment-info' });
    const nameEl = infoEl.createSpan({ cls: 'claudian-attachment-name' });
    nameEl.setText(this.truncateName(name, 22));
    nameEl.setAttribute('title', name);
    infoEl.createSpan({ cls: 'claudian-attachment-meta', text: 'Lädt hoch…' });
  }

  /** A finished, removable chip for a staged non-image file. */
  private renderAttachmentChip(id: string, att: StagedAttachment): void {
    const meta = attachmentTypeMeta(att.name);
    const chip = this.attachmentPreviewEl.createDiv({
      cls: `claudian-attachment-chip claudian-attachment-chip--${meta.typeClass}`,
    });

    const iconWrap = chip.createDiv({ cls: 'claudian-attachment-icon' });
    setIcon(iconWrap, meta.icon);

    const infoEl = chip.createDiv({ cls: 'claudian-attachment-info' });
    const nameEl = infoEl.createSpan({ cls: 'claudian-attachment-name' });
    nameEl.setText(this.truncateName(att.name, 22));
    nameEl.setAttribute('title', att.name);
    infoEl.createSpan({
      cls: 'claudian-attachment-meta',
      text: `${meta.typeClass.toUpperCase()} · ${formatFileSize(att.size)}`,
    });

    const removeEl = chip.createSpan({ cls: 'claudian-attachment-remove' });
    removeEl.setText('×');
    removeEl.setAttribute('aria-label', 'Anhang entfernen');
    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeStagedAttachment(id);
    });
  }

  /** Removes a staged attachment chip and its `@path` mention from the input. */
  private removeStagedAttachment(id: string): void {
    const att = this.stagedAttachments.get(id);
    if (!att) return;
    this.stagedAttachments.delete(id);

    // Strip the injected `@path` mention (with its surrounding newlines) so the
    // chip and the prompt stay in sync.
    const mention = `@${att.relPath}`;
    const el = this.inputEl;
    if (el.value.includes(mention)) {
      el.value = el.value.replace(`\n\n${mention}\n`, '').replace(mention, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    this.updateAttachmentPreview();
    this.callbacks.onImagesChanged();
  }

  /** True when any image or non-image attachment is staged/in-flight. */
  hasAttachments(): boolean {
    return (
      this.attachedImages.size > 0 ||
      this.stagedAttachments.size > 0 ||
      this.pendingUploads.size > 0
    );
  }

  private showFullImage(image: ImageAttachment) {
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private truncateName(name: string, maxLen: number): string {
    if (name.length <= maxLen) return name;
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    const truncatedBase = base.slice(0, maxLen - ext.length - 3);
    return `${truncatedBase}...${ext}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = `${message} (File not found)`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} (Permission denied)`;
      }
    }
    new Notice(userMessage);
  }
}
