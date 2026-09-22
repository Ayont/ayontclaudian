import { Notice } from 'obsidian';
import * as path from 'path';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';
import { updateContextRowHasContent } from '../controllers/contextRowVisibility';
import type { ComposerDraftAttachment } from '../services/ComposerDraftStore';
import type { ImageStagingService } from '../services/ImageStagingService';
import { renderStagedAttachmentChip, renderUploadingAttachmentChip, truncateFileName } from './file-drop/attachmentChipView';
import { attachmentPeekMode, type FileDockTarget } from './file-drop/attachmentMeta';
import { detectPastedTableDelimiter } from './file-drop/delimitedTable';
import {
  countTextLines,
  exceedsInlineTextLimit,
  formatDroppedFileBlock,
  isTextLikeFile,
  MAX_INLINE_TEXT_LINES,
} from './file-drop/droppedTextFile';
import { fingerprintFile } from './file-drop/fileFingerprint';
import { createPdfPeekSrc } from './file-drop/pdfPeek';
import { readTableProfile } from './file-drop/readTableProfile';
import type { ComposerAttachment } from './file-drop/stagedAttachment';
import { normalizeTableProfile, tableFormatForFile, type TableProfile } from './file-drop/tableProfile';

/** A non-image file staged into the vault and shown as a preview chip. */
interface StagedAttachment {
  id: string;
  name: string;
  relPath: string;
  size: number;
  previewSrc?: string;
  /** Structure of a staged table; the agent gets a preview built from it. */
  table?: TableProfile;
  /** Content hash, so an identical second drop is not attached again. */
  fingerprint?: string;
}

interface StageOptions {
  /** Profiles the file while it is being staged (tables). */
  describe?: (file: File) => Promise<TableProfile>;
  fingerprint?: string | null;
  /** Notice shown once the file is attached. */
  stagedNotice?: string;
}

/** What happened to one incoming file; only `unsupported` is counted as skipped. */
type IntakeOutcome = 'accepted' | 'unsupported' | 'handled';

const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const MAX_DESKTOP_INLINE_BYTES = 2 * 1024 * 1024;
/** Paste text above this size as a vault-backed .txt attachment, not a huge prompt. */
export const LARGE_PASTED_TEXT_THRESHOLD = 24 * 1024;
/** Display name of a pasted table; the staged file name is sanitized from it. */
const PASTED_TABLE_NAME = 'Eingefügte Tabelle';

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
  /** Called after a non-image file is staged so the library can remember it. */
  onAttachmentStaged?: (target: FileDockTarget) => void;
  /** Vault resource URL for a staged file (PDF peek in the composer). */
  getResourcePath?: (relPath: string) => string | null;
  /** Stages and decodes Cisco Packet Tracer files into readable XML context. */
  stagePacketTracerAttachment?: (file: File) => Promise<string | null>;
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
  private vaultFilesReadable: () => boolean = () => true;
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
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  setVaultFilesReadable(readable: () => boolean): void {
    this.vaultFilesReadable = readable;
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  /** Stages a captured app-shot PNG into the composer like a dropped image. */
  addAppShot(pngBase64: string, name: string, size: number): boolean {
    if (!this.enabled) {
      new Notice('Dieser Provider unterstützt keine Bildanhänge.');
      return false;
    }
    const attachment: ImageAttachment = {
      id: this.generateId(),
      name,
      mediaType: 'image/png',
      data: pngBase64,
      size,
      source: 'paste',
    };
    this.attachedImages.set(attachment.id, attachment);
    const conversationId = this.callbacks.getConversationId?.() ?? null;
    if (this.stagingService) {
      this.uploadingImageIds.add(attachment.id);
      void this.stagingService.saveImage(attachment, conversationId)
        .catch(() => undefined)
        .finally(() => {
          this.uploadingImageIds.delete(attachment.id);
          this.updateImagePreview();
        });
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
    return true;
  }

  /**
   * Staged (non-image) file attachments for the next send. The send pipeline
   * appends their references (an `@relPath`, or a bounded table block)
   * invisibly to the provider-bound prompt — they are deliberately NOT part of
   * the visible input or chat transcript.
   */
  getStagedAttachments(): ComposerAttachment[] {
    return Array.from(this.stagedAttachments.values())
      .map(({ name, relPath, previewSrc, size, table }) => ({ name, relPath, previewSrc, size, table }));
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
   * Clears compose attachments when switching conversations. Deliberately does
   * not restore prior draft images: reopening Obsidian must never re-paste old
   * images into the input. Sent images remain available in the chat history via
   * the durable image archive.
   */
  async reloadForConversation(): Promise<void> {
    this.attachedImages.clear();
    this.uploadingImageIds.clear();
    this.stagedAttachments.clear();
    this.pendingUploads.clear();
    this.updateImagePreview();
    this.updateAttachmentPreview();
    // Always notify so context-row visibility reflects the empty compose state.
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

  /** Staged file chips as a draft stores them; the preview is rebuilt, not saved. */
  getDraftAttachments(): ComposerDraftAttachment[] {
    return Array.from(this.stagedAttachments.values())
      .map(({ name, relPath, size, table }) => ({ name, relPath, size, ...(table ? { table } : {}) }));
  }

  /** Re-adds file chips from a saved draft. The files are already in the vault. */
  restoreDraftAttachments(attachments: ComposerDraftAttachment[]): void {
    const known = new Set(Array.from(this.stagedAttachments.values(), attachment => attachment.relPath));
    for (const attachment of attachments) {
      if (known.has(attachment.relPath)) continue;
      known.add(attachment.relPath);
      const id = this.generateId();
      const table = normalizeTableProfile(attachment.table);
      this.stagedAttachments.set(id, {
        id,
        name: attachment.name,
        relPath: attachment.relPath,
        size: attachment.size ?? 0,
        ...(table ? { table } : {}),
      });
    }
    this.updateAttachmentPreview();
    this.callbacks.onImagesChanged();
  }

  /**
   * Re-adds draft images whose bytes are still staged. Merges by id, so a second
   * restore of the same draft cannot duplicate them; staging is not rewritten.
   */
  addRestoredImages(images: ImageAttachment[]): void {
    for (const image of images) {
      if (!this.attachedImages.has(image.id)) {
        this.attachedImages.set(image.id, image);
      }
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged();
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
    dropContent.createSpan({ text: 'Bild, Text oder Datei hier ablegen' });

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

    // Content hashes already attached, so an identical second copy of a file
    // (e.g. a repeated `call_reports (1).csv` download) is attached only once.
    const seen = new Map<string, string>();
    for (const attachment of this.stagedAttachments.values()) {
      if (attachment.fingerprint) seen.set(attachment.fingerprint, attachment.name);
    }

    let unsupported = 0;
    for (let i = 0; i < files.length; i++) {
      if (await this.acceptDroppedFile(files[i], seen) === 'unsupported') unsupported++;
    }

    if (unsupported > 0) {
      new Notice(
        `${unsupported} Datei(en) übersprungen — konnten nicht angehängt werden.`,
      );
    }
  }

  private async acceptDroppedFile(file: File, seen: Map<string, string>): Promise<IntakeOutcome> {
    if (this.isImageFile(file)) {
      await this.addImageFromFile(file, 'drop');
      return 'accepted';
    }
    const isTable = tableFormatForFile(file.name) !== null;
    if (isTable || isTextLikeFile(file.name, file.type)) {
      return this.acceptTextOrTable(file, isTable, seen);
    }
    if (this.isPacketTracerFile(file) && this.callbacks.stagePacketTracerAttachment) {
      return await this.stageFileAttachment(file, this.callbacks.stagePacketTracerAttachment) ? 'accepted' : 'unsupported';
    }
    if (this.callbacks.stageVaultAttachment) {
      // PDF / doc / binary: stage into the vault as a chip. The @path
      // reference is appended invisibly at send time so ANY provider's agent
      // can read it (all run with the vault as workspace).
      return await this.stageFileAttachment(file) ? 'accepted' : 'unsupported';
    }
    return 'unsupported';
  }

  /**
   * Tables always become attachments; other text is inlined only while it is
   * small enough to read in a chat bubble (see `exceedsInlineTextLimit`).
   */
  private async acceptTextOrTable(file: File, isTable: boolean, seen: Map<string, string>): Promise<IntakeOutcome> {
    const fingerprint = await fingerprintFile(file);
    const original = fingerprint ? seen.get(fingerprint) : undefined;
    if (original !== undefined) {
      new Notice(`„${file.name}" ist identisch mit „${original}" und wurde übersprungen.`);
      return 'handled';
    }
    if (!this.vaultFilesReadable()) {
      if (file.size > MAX_DESKTOP_INLINE_BYTES) {
        new Notice(`„${file.name}" ist zu groß zum Einfügen (max 2.0 MB).`);
        return 'handled';
      }
      try {
        this.insertIntoInput(formatDroppedFileBlock(file.name, await file.text()));
        return 'accepted';
      } catch {
        new Notice(`„${file.name}" konnte nicht gelesen werden.`);
        return 'handled';
      }
    }

    if (isTable) {
      const outcome = await this.stageAsAttachment(file, { fingerprint, describe: readTableProfile });
      if (outcome === 'accepted' && fingerprint) seen.set(fingerprint, file.name);
      return outcome;
    }
    const tooLong = { fingerprint, stagedNotice: `„${file.name}" ist zu lang zum Einfügen und wurde als Datei angehängt.` };
    if (exceedsInlineTextLimit(file.size)) {
      const outcome = await this.stageAsAttachment(file, tooLong);
      if (outcome === 'accepted' && fingerprint) seen.set(fingerprint, file.name);
      return outcome;
    }

    let content: string;
    try {
      content = await file.text();
    } catch {
      new Notice(`„${file.name}" konnte nicht gelesen werden.`);
      return 'handled';
    }
    if (exceedsInlineTextLimit(file.size, content)) {
      const outcome = await this.stageAsAttachment(file, tooLong);
      if (outcome === 'accepted' && fingerprint) seen.set(fingerprint, file.name);
      return outcome;
    }

    this.insertIntoInput(formatDroppedFileBlock(file.name, content));
    if (fingerprint) seen.set(fingerprint, file.name);
    new Notice(`„${file.name}" als Text eingefügt.`);
    return 'accepted';
  }

  /** Stages through the vault; without staging a large file is refused, never inlined. */
  private async stageAsAttachment(file: File, options: StageOptions): Promise<IntakeOutcome> {
    const stage = this.callbacks.stageVaultAttachment;
    if (!stage) return 'unsupported';
    return await this.stageFileAttachment(file, stage, options) ? 'accepted' : 'unsupported';
  }

  /**
   * Stages a non-image/non-text file into the vault and tracks it as a chip.
   * The `@path` reference is NOT inserted into the visible input — the send
   * pipeline appends it invisibly to the outgoing prompt (see
   * `getStagedAttachments`), so the chat stays clean while every provider can
   * still read the file. Returns false when staging is unavailable or fails.
   */
  private async stageFileAttachment(
    file: File,
    stageAttachment: (file: File) => Promise<string | null> = this.callbacks.stageVaultAttachment ?? (async () => null),
    options: StageOptions = {},
  ): Promise<boolean> {

    // Show an immediate "uploading" chip so the staging is visible. The
    // onImagesChanged() call re-runs the parent context-row visibility check —
    // without it a file-only drop (no image) would set the chip's visible class
    // but never reveal the row, so the chip would stay invisible.
    const pendingId = `att-${this.generateId()}`;
    this.pendingUploads.set(pendingId, file.name);
    this.updateAttachmentPreview();
    this.callbacks.onImagesChanged();

    const [relPath, table] = await Promise.all([
      stageAttachment(file).catch(() => null),
      options.describe ? options.describe(file).catch(() => undefined) : Promise.resolve(undefined),
    ]);

    this.pendingUploads.delete(pendingId);

    if (!relPath) {
      this.updateAttachmentPreview();
      this.callbacks.onImagesChanged();
      new Notice(`„${file.name}" konnte nicht angehängt werden.`);
      return false;
    }

    // Track the staged attachment as a removable preview chip. The @path
    // reference travels invisibly with the next send — no textarea noise.
    const previewSrc = attachmentPeekMode(file.name) === 'iframe'
      ? await createPdfPeekSrc(file)
      : undefined;
    this.stagedAttachments.set(pendingId, {
      id: pendingId,
      name: file.name,
      relPath,
      size: file.size,
      previewSrc: previewSrc ?? undefined,
      ...(table ? { table } : {}),
      ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
    });
    this.updateAttachmentPreview();
    this.callbacks.onImagesChanged();
    this.callbacks.onAttachmentStaged?.({ kind: 'file', path: relPath, name: file.name });
    new Notice(options.stagedNotice ?? `„${file.name}" angehängt.`);
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

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items) return;

      // Read before the image check: Excel also puts a rendered picture of the
      // selection on the clipboard, which is useless for a 2,000-row table.
      const clipboard = e.clipboardData;
      const pastedText = typeof clipboard?.getData === 'function'
        ? clipboard.getData('text/plain')
        : '';
      const pastedTable = pastedText && this.vaultFilesReadable() ? this.largePastedTableFormat(pastedText) : null;
      if (pastedTable) {
        e.preventDefault?.();
        await this.attachPastedTable(pastedText, pastedTable);
        return;
      }

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

      // Keep normal pastes fast and editable. For large clipboard text, mirror
      // Claude Desktop's attachment behavior: write a .txt file to the vault,
      // show a chip, and mention its path rather than flooding the textarea and
      // the provider context with tens of thousands of characters.
      if (pastedText && new Blob([pastedText]).size > LARGE_PASTED_TEXT_THRESHOLD) {
        e.preventDefault?.();
        await this.attachLargePastedText(pastedText);
      }
      })();
    });
  }

  /** `csv`/`tsv` for clipboard text that is a table too large to paste inline. */
  private largePastedTableFormat(text: string): 'csv' | 'tsv' | null {
    const isLarge = new Blob([text]).size > LARGE_PASTED_TEXT_THRESHOLD || countTextLines(text) > MAX_INLINE_TEXT_LINES;
    if (!isLarge) return null;
    const delimiter = detectPastedTableDelimiter(text);
    if (!delimiter) return null;
    return delimiter === '\t' ? 'tsv' : 'csv';
  }

  private async attachPastedTable(content: string, format: 'csv' | 'tsv'): Promise<void> {
    if (!this.callbacks.stageVaultAttachment) {
      new Notice('Große Tabelle kann in dieser Ansicht nicht als Datei angehängt werden.');
      return;
    }
    const file = new File([content], `${PASTED_TABLE_NAME}.${format}`, {
      type: format === 'tsv' ? 'text/tab-separated-values' : 'text/csv',
    });
    await this.stageFileAttachment(file, this.callbacks.stageVaultAttachment, {
      describe: readTableProfile,
      fingerprint: await fingerprintFile(file),
      stagedNotice: 'Eingefügte Tabelle als Datei angehängt.',
    });
  }

  private async attachLargePastedText(content: string): Promise<void> {
    if (!this.callbacks.stageVaultAttachment) {
      new Notice('Großer Text kann in dieser Ansicht nicht als Datei angehängt werden.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([content], `pasted-text-${timestamp}.txt`, {
      type: 'text/plain',
    });
    await this.stageFileAttachment(file);
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private isPacketTracerFile(file: File): boolean {
    return /\.(pkt|pka)$/i.test(file.name);
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = path.extname(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: 'paste' | 'drop'): Promise<boolean> {
    if (!this.enabled) {
      new Notice('Dieser Provider unterstützt keine Bildanhänge.');
      return false;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Bild überschreitet das Limit von ${this.formatSize(MAX_IMAGE_SIZE)}.`);
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError('Nicht unterstütztes Bildformat.');
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
      this.notifyImageError('Bild konnte nicht angehängt werden.', error);
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

  /**
   * Reveals/hides the parent context row to match the current preview state.
   * Called directly (not via the onImagesChanged callback chain) so a file-only
   * attachment ALWAYS reveals the row — the previous bug was that this re-check
   * depended on an external callback that didn't fire for non-image drops.
   */
  private syncContextRowVisibility(): void {
    const el = this.previewContainerEl;
    let row: HTMLElement | null = null;
    if (typeof el.hasClass === 'function' && el.hasClass('claudian-context-row')) {
      row = el;
    } else if (typeof el.closest === 'function') {
      row = el.closest('.claudian-context-row');
    }
    if (!row) return;
    try {
      updateContextRowHasContent(row);
    } catch {
      // Mock/test DOM without full querySelector support — non-fatal.
    }
  }

  private updateImagePreview() {
    this.imagePreviewEl.empty();

    if (this.attachedImages.size === 0) {
      this.imagePreviewEl.removeClass('claudian-visible-flex');
      this.imagePreviewEl.addClass('claudian-hidden');
      this.syncContextRowVisibility();
      return;
    }

    this.imagePreviewEl.addClass('claudian-visible-flex');
    this.imagePreviewEl.removeClass('claudian-hidden');

    for (const [id, image] of this.attachedImages) {
      this.renderImagePreview(id, image);
    }
    this.syncContextRowVisibility();
  }

  private renderImagePreview(id: string, image: ImageAttachment) {
    const previewEl = this.imagePreviewEl.createDiv({ cls: 'claudian-image-chip' });
    const isUploading = this.uploadingImageIds.has(id);
    if (isUploading) previewEl.addClass('claudian-attachment-chip--uploading');

    const thumbEl = previewEl.createEl('button', {
      cls: 'claudian-image-thumb',
      attr: { type: 'button', 'aria-label': `${image.name} vergrößern` },
    });
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

    const removeEl = previewEl.createEl('button', {
      cls: 'claudian-image-remove',
      attr: { type: 'button', 'aria-label': `${image.name} entfernen` },
    });
    removeEl.setText('\u00D7');

    removeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.attachedImages.delete(id);
      void this.stagingService?.deleteImage(id).catch(() => {});
      this.updateImagePreview();
      this.callbacks.onImagesChanged();
    });

    thumbEl.addEventListener('click', () => {
      this.showFullImage(image, thumbEl);
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
      this.syncContextRowVisibility();
      return;
    }

    this.attachmentPreviewEl.addClass('claudian-visible-flex');
    this.attachmentPreviewEl.removeClass('claudian-hidden');

    // In-flight uploads first (spinner chips).
    for (const name of this.pendingUploads.values()) {
      renderUploadingAttachmentChip(this.attachmentPreviewEl, name);
    }
    for (const [id, att] of this.stagedAttachments) {
      renderStagedAttachmentChip(this.attachmentPreviewEl, att, {
        resourcePath: att.previewSrc ?? this.callbacks.getResourcePath?.(att.relPath) ?? null,
        onRemove: () => this.removeStagedAttachment(id),
      });
    }
    this.syncContextRowVisibility();
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

  private showFullImage(image: ImageAttachment, returnFocus?: HTMLElement) {
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', `Bildvorschau: ${image.name}`);

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    modal.createDiv({ cls: 'claudian-image-modal-caption', text: image.name });

    const closeBtn = modal.createEl('button', {
      cls: 'claudian-image-modal-close',
      attr: { type: 'button', 'aria-label': 'Bildvorschau schließen' },
    });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault?.();
        close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeBtn.focus();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
      if (returnFocus?.isConnected !== false) {
        returnFocus?.focus();
      }
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
    closeBtn.focus();
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private truncateName(name: string, maxLen: number): string {
    return truncateFileName(name, maxLen);
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
        userMessage = `${message} (Datei nicht gefunden)`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} (Zugriff verweigert)`;
      }
    }
    new Notice(userMessage);
  }
}
