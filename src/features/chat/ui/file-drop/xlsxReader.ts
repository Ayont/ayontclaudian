/**
 * Minimal .xlsx reader for the attachment preview: sheet names, used ranges,
 * header and first rows. An xlsx file is a ZIP of XML parts, and Node's zlib is
 * already part of the bundle, so this needs no spreadsheet dependency. It reads
 * a compressed prefix of each worksheet, never the whole grid.
 */

import { constants as zlibConstants, inflateRawSync } from 'zlib';

import {
  capCell,
  capRow,
  MAX_PREVIEW_ROWS,
  MAX_PREVIEWED_SHEETS,
  MAX_PROFILE_COLUMNS,
  MAX_PROFILE_SHEETS,
  type TableProfile,
  type TableSheetProfile,
} from './tableProfile';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
const ZIP64_MARKER = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export const XLSX_VALUE_NOTE = 'Values are raw cell values; dates may appear as Excel serial numbers.';

export interface XlsxReadLimits {
  /** Compressed bytes of a worksheet inflated for the preview. */
  maxSheetCompressedBytes?: number;
  /** Upper bound for any inflated XML part. */
  maxInflatedBytes?: number;
}

// XML compresses roughly 10–20×: 512 KB of deflate is several MB of sheet XML,
// far more than a header and five rows need, while the output cap keeps a
// pathological (zip-bomb) part from exhausting memory.
const DEFAULT_SHEET_COMPRESSED_BYTES = 512 * 1024;
const DEFAULT_MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** Shared strings are indexed from anywhere, so they get a larger slice. */
const SHARED_STRINGS_COMPRESSED_BYTES = 4 * 1024 * 1024;

interface ZipEntry {
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

interface InflatedPart {
  text: string;
  /** False when only a prefix of the part could be read. */
  complete: boolean;
}

function findEndOfCentralDirectory(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - EOCD_MIN_BYTES - MAX_ZIP_COMMENT_BYTES);
  for (let offset = view.byteLength - EOCD_MIN_BYTES; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('not a zip archive');
}

function listZipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.byteLength < EOCD_MIN_BYTES) throw new Error('not a zip archive');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === ZIP64_MARKER) throw new Error('zip64 archives are not supported');

  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error('corrupt zip central directory');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function inflatePart(bytes: Uint8Array, entry: ZipEntry, maxCompressed: number, maxInflated: number): InflatedPart {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || view.getUint32(local, true) !== LOCAL_SIGNATURE) {
    throw new Error('corrupt zip entry');
  }
  const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const available = Math.min(entry.compressedSize, bytes.byteLength - dataStart);

  if (entry.method === METHOD_STORED) {
    const length = Math.min(available, maxInflated);
    return {
      text: new TextDecoder().decode(bytes.subarray(dataStart, dataStart + length)),
      complete: length === entry.compressedSize,
    };
  }
  if (entry.method !== METHOD_DEFLATE) throw new Error(`unsupported zip compression ${entry.method}`);
  if (available <= 0) return { text: '', complete: entry.compressedSize === 0 };

  // A truncated deflate stream is fine with SYNC_FLUSH: zlib returns what it
  // could decode instead of failing on the missing end. If that still exceeds
  // the output cap, retry with less input rather than giving up.
  for (let length = Math.min(available, maxCompressed); length > 0; length = Math.floor(length / 4)) {
    try {
      const output = inflateRawSync(bytes.subarray(dataStart, dataStart + length), {
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
        maxOutputLength: maxInflated,
      });
      return { text: output.toString('utf8'), complete: length === entry.compressedSize };
    } catch (error) {
      if (!(error instanceof RangeError) && (error as { code?: string }).code !== 'ERR_BUFFER_TOO_LARGE') throw error;
    }
  }
  return { text: '', complete: false };
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return decodeCodePoint(parseInt(lower.slice(2), 16), match);
    if (lower.startsWith('#')) return decodeCodePoint(parseInt(lower.slice(1), 10), match);
    return XML_ENTITIES[lower] ?? match;
  });
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result.set(match[1], decodeXml(match[2] ?? match[3] ?? ''));
  }
  return result;
}

// SpreadsheetML may be written with a namespace prefix (`<x:row>`); every
// element pattern accepts one.
const NS = '(?:[A-Za-z_][\\w.-]*:)?';
const element = (name: string, flags = 'g'): RegExp =>
  new RegExp(`<${NS}${name}\\b[^>]*>([\\s\\S]*?)<\\/${NS}${name}>`, flags);
const TEXT_RUN = element('t');
const PHONETIC_RUN = element('rPh');
const STRING_ITEM = element('si');
const CELL_VALUE = element('v', '');
const CELL = new RegExp(`<${NS}c\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${NS}c>)`, 'g');
// The first alternative is an empty, self-closing `<row/>`; it still counts.
const ROW = new RegExp(`<${NS}row\\b([^>]*?)\\/>|<${NS}row\\b([^>]*)>([\\s\\S]*?)<\\/${NS}row>`, 'g');
const DIMENSION = new RegExp(`<${NS}dimension\\b([^>]*?)\\/?>`);
const SHEET = new RegExp(`<${NS}sheet\\b([^>]*?)\\/?>`, 'g');
const RELATIONSHIP = new RegExp(`<${NS}Relationship\\b([^>]*?)\\/?>`, 'g');

/** Columns of an Excel worksheet (A…XFD); anything beyond is a corrupt or crafted reference. */
const EXCEL_MAX_COLUMNS = 16_384;

/** Concatenated `<t>` runs of a string item, without phonetic (`<rPh>`) hints. */
function runText(xml: string): string {
  let text = '';
  for (const match of xml.replace(PHONETIC_RUN, '').matchAll(TEXT_RUN)) {
    text += decodeXml(match[1]);
  }
  return text;
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(STRING_ITEM), (match) => runText(match[1]));
}

/** Zero-based column of a cell reference, or -1 when it is not a valid Excel column. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]{1,3}/i.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index >= 1 && index <= EXCEL_MAX_COLUMNS && !/^[A-Z]{4}/i.test(ref) ? index - 1 : -1;
}

function cellValue(attrs: Map<string, string>, inner: string, shared: readonly string[]): string {
  const type = attrs.get('t');
  if (type === 'inlineStr') return runText(inner);
  const raw = CELL_VALUE.exec(inner)?.[1];
  if (raw === undefined) return '';
  const value = decodeXml(raw);
  if (type === 's') return shared[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return value;
}

interface ParsedRow {
  /** Cells up to the profile column limit. */
  cells: string[];
  /** Column count including cells beyond the limit, which are never materialized. */
  width: number;
}

function parseRow(rowXml: string, shared: readonly string[]): ParsedRow {
  const cells: string[] = [];
  let width = 0;
  let next = 0;
  for (const match of rowXml.matchAll(CELL)) {
    const attrs = attributes(match[1]);
    const ref = attrs.get('r');
    const index = ref ? columnIndex(ref) : next;
    if (index < 0) continue;
    next = index + 1;
    width = Math.max(width, index + 1);
    if (index >= MAX_PROFILE_COLUMNS) continue;
    while (cells.length < index) cells.push('');
    cells[index] = cellValue(attrs, match[2] ?? '', shared);
  }
  return { cells, width };
}

interface ParsedRange {
  ref: string;
  rows: number;
  columns: number;
  /** Absolute bounds, to check parsed rows against. */
  lastRow: number;
  lastColumn: number;
}

function parseRange(sheetXml: string): ParsedRange | null {
  const tag = DIMENSION.exec(sheetXml)?.[1];
  const ref = tag ? attributes(tag).get('ref') : undefined;
  const match = ref ? /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/i.exec(ref) : null;
  if (!ref || !match) return null;
  const startRow = Number(match[2]);
  const endRow = Number(match[4] ?? match[2]);
  const startCol = columnIndex(match[1]);
  const endCol = columnIndex(match[3] ?? match[1]);
  if (startCol < 0 || endCol < startCol || endRow < startRow) return null;
  return { ref, rows: endRow - startRow + 1, columns: endCol - startCol + 1, lastRow: endRow, lastColumn: endCol + 1 };
}

interface RowScan {
  /** First non-empty rows (header + preview). */
  rows: string[][];
  /** Row elements seen, empty ones included. */
  elements: number;
  /** Highest `r` row number seen; sparse sheets skip numbers. */
  lastRow: number;
  widest: number;
}

function scanRows(sheetXml: string, shared: readonly string[]): RowScan {
  const scan: RowScan = { rows: [], elements: 0, lastRow: 0, widest: 0 };
  for (const match of sheetXml.matchAll(ROW)) {
    scan.elements++;
    const rowNumber = Number(attributes(match[1] ?? match[2] ?? '').get('r'));
    scan.lastRow = Math.max(scan.lastRow, Number.isInteger(rowNumber) ? rowNumber : scan.elements);
    if (match[3] === undefined || scan.rows.length > MAX_PREVIEW_ROWS) continue;
    const { cells, width } = parseRow(match[3], shared);
    scan.widest = Math.max(scan.widest, width);
    if (cells.some((cell) => cell !== '')) scan.rows.push(cells);
  }
  return scan;
}

function profileSheet(name: string, part: InflatedPart, shared: readonly string[], withRows: boolean): TableSheetProfile {
  const scan = scanRows(part.text, shared);
  // Some writers leave a placeholder such as `A1`; a range the rows already
  // exceed says nothing about the sheet.
  const declared = parseRange(part.text);
  const range = declared && scan.lastRow <= declared.lastRow && scan.widest <= declared.lastColumn ? declared : null;
  const counted = part.complete && scan.elements > 0 ? Math.max(scan.elements, scan.lastRow) : undefined;
  const totalRows = range?.rows ?? counted;
  const columns = range?.columns ?? (scan.widest > 0 ? scan.widest : undefined);
  const [header = [], ...data] = scan.rows;
  return {
    name: capCell(name),
    ...(totalRows !== undefined ? { rowCount: Math.max(0, totalRows - 1) } : {}),
    ...(columns !== undefined ? { columnCount: columns } : {}),
    ...(range ? { range: range.ref } : {}),
    header: withRows ? capRow(header) : [],
    rows: withRows ? data.slice(0, MAX_PREVIEW_ROWS).map(capRow) : [],
  };
}

interface SheetRef {
  name: string;
  path: string;
}

function resolveSheetPath(target: string): string {
  const trimmed = target.replace(/^\/+/, '');
  return trimmed.startsWith('xl/') ? trimmed : `xl/${trimmed.replace(/^\.\//, '')}`;
}

function listSheets(workbookXml: string, relsXml: string): SheetRef[] {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(RELATIONSHIP)) {
    const attrs = attributes(match[1]);
    const id = attrs.get('Id');
    const target = attrs.get('Target');
    if (id && target) targets.set(id, resolveSheetPath(target));
  }
  return Array.from(workbookXml.matchAll(SHEET), (match, index) => {
    const attrs = attributes(match[1]);
    const relId = Array.from(attrs.entries()).find(([key]) => /(^|:)id$/.test(key))?.[1];
    return {
      name: attrs.get('name') ?? `Sheet${index + 1}`,
      path: (relId && targets.get(relId)) ?? `xl/worksheets/sheet${index + 1}.xml`,
    };
  });
}

/** Structural profile of an .xlsx workbook. Throws when the bytes are not a readable workbook. */
export function readXlsxProfile(bytes: Uint8Array, limits: XlsxReadLimits = {}): TableProfile {
  const maxSheet = limits.maxSheetCompressedBytes ?? DEFAULT_SHEET_COMPRESSED_BYTES;
  const maxInflated = limits.maxInflatedBytes ?? DEFAULT_MAX_INFLATED_BYTES;
  const entries = listZipEntries(bytes);
  const workbook = entries.get('xl/workbook.xml');
  if (!workbook) throw new Error('zip archive is not an Excel workbook');

  const read = (entry: ZipEntry | undefined, maxCompressed: number): InflatedPart =>
    entry ? inflatePart(bytes, entry, maxCompressed, maxInflated) : { text: '', complete: true };
  const workbookXml = read(workbook, Number.MAX_SAFE_INTEGER).text;
  const relsXml = read(entries.get('xl/_rels/workbook.xml.rels'), Number.MAX_SAFE_INTEGER).text;
  const shared = parseSharedStrings(read(entries.get('xl/sharedStrings.xml'), SHARED_STRINGS_COMPRESSED_BYTES).text);

  const sheets = listSheets(workbookXml, relsXml)
    .slice(0, MAX_PROFILE_SHEETS)
    .map((sheet, index) => {
      const withRows = index < MAX_PREVIEWED_SHEETS;
      // Later sheets only need their <dimension>, which sits at the very top.
      const part = read(entries.get(sheet.path), withRows ? maxSheet : Math.min(maxSheet, 16 * 1024));
      return profileSheet(sheet.name, part, shared, withRows);
    });

  return { format: 'xlsx', sheets, note: XLSX_VALUE_NOTE };
}
