/**
 * Turns an attachment persisted on a sent message back into what the composer
 * would hand the send path, so a resent turn carries the same files.
 */

import type { MessageAttachment } from '../../../../core/types';
import { readTableProfile } from './readTableProfile';
import type { ComposerAttachment } from './stagedAttachment';
import { tableFormatForFile, type TableProfile } from './tableProfile';

const SUMMARY_ONLY_NOTE = 'No preview: the file could not be re-read for this resend.';

/** Only the counts survive persistence; the agent still gets the path and the size of the table. */
function profileFromSummary(attachment: MessageAttachment): TableProfile {
  const summary = attachment.table ?? {};
  return {
    format: tableFormatForFile(attachment.name) ?? 'csv',
    sheets: [{
      ...(summary.rows !== undefined ? { rowCount: summary.rows } : {}),
      ...(summary.columns !== undefined ? { columnCount: summary.columns } : {}),
      header: [],
      rows: [],
    }],
    note: SUMMARY_ONLY_NOTE,
  };
}

/**
 * A table has to be profiled again: the message keeps its counts but never its
 * rows, and a table referenced as a bare `@path` would let a CLI inline all of it.
 */
export async function restoreComposerAttachment(
  attachment: MessageAttachment,
  readBinary: (relPath: string) => Promise<ArrayBuffer>,
): Promise<ComposerAttachment> {
  const { table, ...file } = attachment;
  if (!table) return file;
  try {
    const blob = new Blob([await readBinary(attachment.relPath)]);
    const profile = await readTableProfile(Object.assign(blob, { name: attachment.name }));
    return { ...file, table: profile };
  } catch {
    return { ...file, table: profileFromSummary(attachment) };
  }
}
