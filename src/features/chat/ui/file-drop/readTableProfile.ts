/**
 * Reads a dropped/pasted table file into a {@link TableProfile}. Never throws:
 * a file that cannot be profiled still becomes an attachment, and the agent is
 * told honestly why there is no preview.
 */

import { profileDelimitedText } from './delimitedTable';
import { type TableFormat, tableFormatForFile, type TableProfile, type TableTextEncoding } from './tableProfile';
import { readXlsxProfile } from './xlsxReader';

/** Above this, only the beginning of a CSV is scanned and xlsx is not opened. */
export const MAX_TABLE_SCAN_BYTES = 64 * 1024 * 1024;
const TABLE_PREFIX_BYTES = 1024 * 1024;

const UNPARSED_NOTES: Partial<Record<TableFormat, string>> = {
  xls: 'No preview: legacy Excel (.xls) files are not parsed here. Read it with e.g. Python pandas.read_excel (xlrd).',
  ods: 'No preview: OpenDocument spreadsheets are not parsed here. Read it with e.g. Python pandas.read_excel(engine="odf").',
};

function utf16ByteOrder(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

interface DecodedTableText {
  text: string;
  encoding: TableTextEncoding;
}

/**
 * UTF-16 by byte-order mark (Excel's "Unicode text" export), else UTF-8 when
 * valid, else windows-1252 — the encoding of German Excel CSV exports. Reading
 * UTF-16 as a single-byte encoding would put a NUL between every character.
 */
export function decodeTableText(bytes: Uint8Array): DecodedTableText {
  const utf16 = utf16ByteOrder(bytes);
  if (utf16) return { text: new TextDecoder(utf16).decode(bytes), encoding: utf16 };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

async function readDelimited(file: Blob, format: 'csv' | 'tsv'): Promise<TableProfile> {
  const complete = file.size <= MAX_TABLE_SCAN_BYTES;
  const source = complete ? file : file.slice(0, TABLE_PREFIX_BYTES);
  const bytes = new Uint8Array(await source.arrayBuffer());
  // A cut prefix may end inside a multi-byte character; that must not flip the
  // whole file to windows-1252.
  const decoded = decodeTableText(complete || utf16ByteOrder(bytes) ? bytes : trimPartialUtf8(bytes));
  return profileDelimitedText(decoded.text, format, { complete, encoding: decoded.encoding });
}

function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) !== 0x80) {
      // Lead byte: drop it when its sequence is longer than what follows it.
      const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
      if (length > back) end -= back;
      break;
    }
  }
  return bytes.subarray(0, end);
}

async function readWorkbook(file: Blob): Promise<TableProfile> {
  if (file.size > MAX_TABLE_SCAN_BYTES) {
    return { format: 'xlsx', sheets: [], note: 'No preview: the workbook is too large to open here. Read it with e.g. Python openpyxl (read_only=True).' };
  }
  try {
    return readXlsxProfile(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return { format: 'xlsx', sheets: [], note: 'No preview: the workbook could not be read here. Read it with e.g. Python pandas/openpyxl.' };
  }
}

export async function readTableProfile(file: Blob & { name: string }): Promise<TableProfile> {
  const format = tableFormatForFile(file.name) ?? 'csv';
  try {
    if (format === 'csv' || format === 'tsv') return await readDelimited(file, format);
    if (format === 'xlsx') return await readWorkbook(file);
  } catch {
    return { format, sheets: [], note: 'No preview: the file could not be read here.' };
  }
  const note = UNPARSED_NOTES[format];
  return note ? { format, sheets: [], note } : { format, sheets: [] };
}
