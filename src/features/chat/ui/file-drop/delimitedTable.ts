/**
 * CSV/TSV sniffing and profiling. Pure: one linear, quote-aware pass counts
 * every record while only the header and the preview rows are materialized, so
 * a multi-megabyte export never becomes a second in-memory table.
 */

import {
  capRow,
  MAX_PREVIEW_ROWS,
  MAX_PROFILE_CELL_CHARS,
  MAX_PROFILE_COLUMNS,
  type TableDelimiter,
  type TableProfile,
  type TableTextEncoding,
} from './tableProfile';

const SNIFF_SAMPLE_CHARS = 64 * 1024;
const SNIFF_SAMPLE_LINES = 50;
/** A sniffed delimiter must split at least this share of the sampled lines identically. */
const MIN_SNIFF_CONSISTENCY = 0.6;
/** Pasted text is only turned into a table when it is unmistakably one. */
const MIN_PASTED_TABLE_LINES = 5;
const MIN_PASTED_TABLE_CONSISTENCY = 0.9;
/** Fields are capped for display anyway; the buffer only needs room to trim. */
const MAX_FIELD_BUFFER = MAX_PROFILE_CELL_CHARS * 4;
/** Share of lines opening like code or Markdown (`[`, `{`, `(`, `|`) that rules a paste out. */
const MAX_STRUCTURED_LINE_SHARE = 0.5;
/** Excel writes `sep=;` as the first line when the delimiter is not the locale default. */
const EXCEL_SEPARATOR_HINT = /^sep=(.)\r?\n/i;

// Order is the tie-break: an Excel selection is tab-separated, German Excel
// exports use semicolons (their decimals contain commas).
const SNIFF_CANDIDATES: readonly TableDelimiter[] = ['\t', ';', ',', '|'];
// Pipes are left out on purpose: a pasted Markdown table should stay text.
const PASTE_CANDIDATES: readonly TableDelimiter[] = ['\t', ';', ','];

function sampleLines(text: string): string[] {
  return text
    .slice(0, SNIFF_SAMPLE_CHARS)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(0, SNIFF_SAMPLE_LINES);
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  let atFieldStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === delimiter) {
      count++;
      atFieldStart = true;
    } else if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else {
      atFieldStart = false;
    }
  }
  return count;
}

interface DelimiterFit {
  delimiter: TableDelimiter;
  /** Most common per-line delimiter count (ties go to the larger count). */
  mode: number;
  /** Share of lines whose count equals the mode. */
  consistency: number;
}

function fitDelimiter(lines: readonly string[], delimiter: TableDelimiter): DelimiterFit {
  const frequency = new Map<number, number>();
  for (const line of lines) {
    const count = countOutsideQuotes(line, delimiter);
    frequency.set(count, (frequency.get(count) ?? 0) + 1);
  }
  let mode = 0;
  let modeLines = 0;
  for (const [count, lineCount] of frequency) {
    if (count === 0) continue;
    if (lineCount > modeLines || (lineCount === modeLines && count > mode)) {
      mode = count;
      modeLines = lineCount;
    }
  }
  return { delimiter, mode, consistency: lines.length ? modeLines / lines.length : 0 };
}

function bestFit(fits: DelimiterFit[]): DelimiterFit | null {
  // `sort` is stable, so equal fits keep the candidate order as tie-break.
  const ranked = [...fits].sort((a, b) => b.consistency - a.consistency || b.mode - a.mode);
  return ranked[0] ?? null;
}

/** The delimiter that splits the sample most consistently, or null for single-column text. */
export function sniffDelimiter(text: string): TableDelimiter | null {
  const lines = sampleLines(text);
  const fits = SNIFF_CANDIDATES
    .map((delimiter) => fitDelimiter(lines, delimiter))
    .filter((fit) => fit.mode > 0 && fit.consistency >= MIN_SNIFF_CONSISTENCY);
  return bestFit(fits)?.delimiter ?? null;
}

/**
 * Delimiter of clipboard text that is clearly a table, else null. Stricter than
 * {@link sniffDelimiter}: prose, code and JSON must stay ordinary pastes, so
 * comma/semicolon tables need three columns and nearly every line must agree.
 */
export function detectPastedTableDelimiter(text: string): TableDelimiter | null {
  if (/^[[{<]/.test(text.trimStart())) return null;
  // Indentation is not a column: a stack trace's leading tabs would read as TSV.
  const lines = sampleLines(text).map((line) => line.trimStart());
  if (lines.length < MIN_PASTED_TABLE_LINES) return null;
  const structured = lines.filter((line) => /^[[{(|]/.test(line)).length;
  if (structured / lines.length >= MAX_STRUCTURED_LINE_SHARE) return null;
  const fits = PASTE_CANDIDATES
    .map((delimiter) => fitDelimiter(lines, delimiter))
    .filter((fit) => fit.mode >= (fit.delimiter === '\t' ? 1 : 2) && fit.consistency >= MIN_PASTED_TABLE_CONSISTENCY);
  return bestFit(fits)?.delimiter ?? null;
}

interface DelimitedScan {
  /** The first `keep` records, capped to the profile column limit. */
  records: string[][];
  recordCount: number;
  /** Field count of the first record (the header). */
  firstWidth: number;
  /** The text ended inside a quoted field, so the record count is not trustworthy. */
  unterminated: boolean;
}

function scanDelimited(text: string, delimiter: string, keep: number): DelimitedScan {
  const records: string[][] = [];
  let recordCount = 0;
  let firstWidth = 0;
  let row: string[] = [];
  let field = '';
  let fieldIndex = 0;
  let inQuotes = false;
  let atFieldStart = true;
  let rowHasContent = false;

  const collecting = (): boolean => records.length < keep;
  const append = (ch: string): void => {
    if (collecting() && fieldIndex < MAX_PROFILE_COLUMNS && field.length < MAX_FIELD_BUFFER) field += ch;
  };
  const endField = (): void => {
    if (collecting() && fieldIndex < MAX_PROFILE_COLUMNS) row.push(field);
    field = '';
    fieldIndex++;
    atFieldStart = true;
  };
  const endRecord = (): void => {
    if (rowHasContent) {
      endField();
      if (recordCount === 0) firstWidth = fieldIndex;
      recordCount++;
      if (collecting()) records.push(row);
    }
    row = [];
    field = '';
    fieldIndex = 0;
    atFieldStart = true;
    rowHasContent = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') append(ch);
      else if (text[i + 1] === '"') { append('"'); i++; }
      else inQuotes = false;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    rowHasContent = true;
    if (ch === delimiter) {
      endField();
    } else if (ch === '"' && atFieldStart) {
      // RFC 4180 quotes only open a field; `27" wide` stays literal.
      inQuotes = true;
      atFieldStart = false;
    } else {
      atFieldStart = false;
      append(ch);
    }
  }
  const unterminated = inQuotes;
  endRecord();
  return { records, recordCount, firstWidth, unterminated };
}

export interface DelimitedProfileOptions {
  /** False when `text` is only the beginning of the file: the row count is then unknown. */
  complete?: boolean;
  encoding?: TableTextEncoding;
}

function separatorHint(text: string): { delimiter: TableDelimiter | null; body: string } {
  const hint = EXCEL_SEPARATOR_HINT.exec(text);
  if (!hint) return { delimiter: null, body: text };
  const delimiter = (SNIFF_CANDIDATES as readonly string[]).includes(hint[1]) ? hint[1] as TableDelimiter : null;
  return { delimiter, body: text.slice(hint[0].length) };
}

function scanNote(complete: boolean, unterminated: boolean): string | undefined {
  if (!complete) return 'Only the beginning of the file was scanned; the row count is unknown.';
  if (unterminated) return 'The file ends inside a quoted field; the row count is unknown.';
  return undefined;
}

/** Header, first rows and counts of a CSV/TSV text. The first record is taken as header. */
export function profileDelimitedText(
  text: string,
  format: 'csv' | 'tsv',
  options: DelimitedProfileOptions = {},
): TableProfile {
  const hint = separatorHint(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const delimiter = format === 'tsv' ? '\t' : (hint.delimiter ?? sniffDelimiter(hint.body) ?? ',');
  const { records, recordCount, firstWidth, unterminated } = scanDelimited(hint.body, delimiter, MAX_PREVIEW_ROWS + 1);
  const note = scanNote(options.complete !== false, unterminated);
  const [header = [], ...rows] = records;

  return {
    format,
    delimiter,
    ...(options.encoding && options.encoding !== 'utf-8' ? { encoding: options.encoding } : {}),
    sheets: [{
      ...(note ? {} : { rowCount: Math.max(0, recordCount - 1) }),
      ...(recordCount > 0 ? { columnCount: firstWidth } : {}),
      header: capRow(header),
      rows: rows.map(capRow),
    }],
    ...(note ? { note } : {}),
  };
}
