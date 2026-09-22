/**
 * Composer chips for staged (non-image) files: a spinner chip while a file is
 * being staged and a removable chip with a visual peek once it is attached.
 */

import { setIcon } from 'obsidian';
import * as path from 'path';

import { attachmentPeekMode, attachmentTypeMeta } from './attachmentMeta';
import { isRasterPeekSrc } from './pdfPeek';
import { composerChipMeta } from './stagedAttachment';
import type { TableProfile } from './tableProfile';

const CHIP_NAME_CHARS = 22;

export interface AttachmentChipData {
  name: string;
  size: number;
  table?: TableProfile;
}

export interface AttachmentChipOptions {
  /** Preview image/PDF source, when the file kind has one. */
  resourcePath: string | null;
  onRemove: () => void;
}

/** Shortens a file name in the middle so its extension stays visible. */
export function truncateFileName(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  const truncatedBase = base.slice(0, maxLen - ext.length - 3);
  return `${truncatedBase}...${ext}`;
}

function renderName(infoEl: HTMLElement, name: string): void {
  const nameEl = infoEl.createSpan({ cls: 'claudian-attachment-name' });
  nameEl.setText(truncateFileName(name, CHIP_NAME_CHARS));
  nameEl.setAttribute('title', name);
}

export function renderUploadingAttachmentChip(parentEl: HTMLElement, name: string): void {
  const meta = attachmentTypeMeta(name);
  const chip = parentEl.createDiv({
    cls: `claudian-attachment-chip claudian-attachment-chip--${meta.typeClass} claudian-attachment-chip--uploading`,
  });
  const iconWrap = chip.createDiv({ cls: 'claudian-attachment-icon' });
  iconWrap.createDiv({ cls: 'claudian-attachment-spinner' });

  const infoEl = chip.createDiv({ cls: 'claudian-attachment-info' });
  renderName(infoEl, name);
  infoEl.createSpan({ cls: 'claudian-attachment-meta', text: 'Lädt hoch…' });
}

function renderPeek(chip: HTMLElement, name: string, resourcePath: string | null): void {
  const peek = attachmentPeekMode(name);
  const showsImage = resourcePath && ((peek === 'iframe' && isRasterPeekSrc(resourcePath)) || peek === 'thumb');
  if (showsImage) {
    const peekEl = chip.createDiv({ cls: 'claudian-attachment-peek' });
    peekEl.createEl('img', {
      cls: 'claudian-attachment-peek-image',
      attr: { src: resourcePath, alt: name },
    });
    return;
  }
  if (peek === 'iframe' && resourcePath) {
    const peekEl = chip.createDiv({ cls: 'claudian-attachment-peek' });
    const frame = peekEl.createEl('iframe', {
      cls: 'claudian-attachment-peek-pdf',
      attr: { src: resourcePath, tabindex: '-1', title: name },
    });
    frame.addClass('claudian-attachment-peek-pdf');
    return;
  }
  const peekEl = chip.createDiv({ cls: 'claudian-attachment-peek claudian-attachment-peek--paper' });
  peekEl.createDiv({ cls: 'claudian-attachment-peek-sheet' });
  const face = peekEl.createDiv({ cls: 'claudian-attachment-peek-face' });
  setIcon(face.createSpan(), attachmentTypeMeta(name).icon);
}

export function renderStagedAttachmentChip(
  parentEl: HTMLElement,
  attachment: AttachmentChipData,
  options: AttachmentChipOptions,
): void {
  const meta = attachmentTypeMeta(attachment.name);
  const chip = parentEl.createDiv({
    cls: `claudian-attachment-chip claudian-attachment-chip--${meta.typeClass} claudian-attachment-chip--peek`,
  });
  renderPeek(chip, attachment.name, options.resourcePath);

  const row = chip.createDiv({ cls: 'claudian-attachment-row' });
  const iconWrap = row.createDiv({ cls: 'claudian-attachment-icon' });
  setIcon(iconWrap, meta.icon);

  const infoEl = row.createDiv({ cls: 'claudian-attachment-info' });
  renderName(infoEl, attachment.name);
  infoEl.createSpan({ cls: 'claudian-attachment-meta', text: composerChipMeta(attachment) });

  const removeEl = chip.createEl('button', {
    cls: 'claudian-attachment-remove',
    attr: { type: 'button', 'aria-label': `${attachment.name} entfernen` },
  });
  removeEl.setText('×');
  removeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    options.onRemove();
  });
}
