/**
 * Bridges composer attachments to the two things a send produces: the prompt
 * reference the agent reads and the attachment persisted on the chat message.
 */

import type { MessageAttachment } from '../../../../core/types';
import { attachmentTypeMeta, fileExtension, formatFileSize } from './attachmentMeta';
import { formatTableSummary, summarizeTableProfile, type TableProfile } from './tableProfile';
import { formatTableReferenceBlock } from './tableReference';

/** A staged file as the composer hands it to the send path. */
export interface ComposerAttachment {
  name: string;
  relPath: string;
  previewSrc?: string;
  size?: number;
  /** Present for tables; carries the preview the agent-facing block is built from. */
  table?: TableProfile;
}

/** The persisted form: a table keeps its summary, never its preview rows. */
export function toMessageAttachment(attachment: ComposerAttachment): MessageAttachment {
  const { table, ...rest } = attachment;
  return table ? { ...rest, table: summarizeTableProfile(table) } : rest;
}

/**
 * How one attachment appears in the prompt. Tables get a bounded block with the
 * plain path instead of an `@path` mention, so a CLI that expands mentions can
 * never inline the full table after all.
 */
export function attachmentPromptReference(attachment: ComposerAttachment): string {
  return attachment.table
    ? formatTableReferenceBlock({ ...attachment, table: attachment.table })
    : `@${attachment.relPath}`;
}

export function attachmentPromptReferences(attachments: readonly ComposerAttachment[]): string {
  return attachments.map(attachmentPromptReference).join('\n');
}

/**
 * Bubble text of an attachment-only send. A resend recognizes it by this exact
 * label and does not mistake it for something the user typed.
 */
export function attachmentOnlyDisplayContent(attachments: ReadonlyArray<Pick<ComposerAttachment, 'name'>>): string {
  return attachments.length > 0 ? `📎 ${attachments.map((att) => att.name).join(', ')}` : '';
}

/** Composer chip meta: "CSV · 2.277 Zeilen · 9 Spalten" for tables, "PDF · 1.2 MB" otherwise. */
export function composerChipMeta(attachment: Pick<ComposerAttachment, 'name' | 'size' | 'table'>): string {
  const size = formatFileSize(attachment.size ?? 0);
  if (!attachment.table) return `${attachmentTypeMeta(attachment.name).typeClass.toUpperCase()} · ${size}`;
  const label = (fileExtension(attachment.name) || attachment.table.format).toUpperCase();
  return `${label} · ${formatTableSummary(summarizeTableProfile(attachment.table)) || size}`;
}
