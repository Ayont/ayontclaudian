/**
 * Structural description of a staged table (CSV/TSV or spreadsheet): header,
 * a few rows and counts — never the table itself. The profile travels with the
 * composer chip and the draft; the agent receives it as a bounded reference
 * block and opens the vault file with its own tools for anything more.
 */

import type { MessageAttachmentTableSummary } from '../../../../core/types';

export type TableFormat = 'csv' | 'tsv' | 'xlsx' | 'xls' | 'ods' | 'numbers';
export type TableDelimiter = ',' | ';' | '\t' | '|';
export type TableTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

// Profiles are persisted in drafts, so every dimension is capped. The reference
// block renders less than this; the caps only bound what can ever be stored.
export const MAX_PROFILE_COLUMNS = 40;
export const MAX_PREVIEW_ROWS = 5;
export const MAX_PROFILE_CELL_CHARS = 60;
export const MAX_PROFILE_SHEETS = 32;
/** Workbooks keep header and rows for the first sheets only; the rest keep name and size. */
export const MAX_PREVIEWED_SHEETS = 3;
const MAX_NOTE_CHARS = 300;

export interface TableSheetProfile {
  name?: string;
  /** Data rows below the header; absent when the scan could not reach the end. */
  rowCount?: number;
  columnCount?: number;
  /** Used range as written by the producer, e.g. `A1:M2278`. */
  range?: string;
  header: string[];
  rows: string[][];
}

export interface TableProfile {
  format: TableFormat;
  delimiter?: TableDelimiter;
  /** Only set when the text is not UTF-8, so the agent opens it correctly. */
  encoding?: TableTextEncoding;
  sheets: TableSheetProfile[];
  /** Agent-facing reason why the preview is missing or partial. */
  note?: string;
}

const FORMATS: readonly TableFormat[] = ['csv', 'tsv', 'xlsx', 'xls', 'ods', 'numbers'];
const DELIMITERS: readonly TableDelimiter[] = [',', ';', '\t', '|'];
const ENCODINGS: readonly TableTextEncoding[] = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'];
// C0/C1 controls except tabs and line breaks, which collapse to a space below.
// A NUL must never reach a prompt: several CLIs receive it as a spawn argument,
// and Node rejects arguments containing NUL bytes.
// eslint-disable-next-line no-control-regex -- Explicitly remove dangerous controls while preserving whitespace for normalization.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Table format by extension; `null` for everything that is not a table. */
export function tableFormatForFile(name: string): TableFormat | null {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = base.slice(dot + 1);
  return (FORMATS as readonly string[]).includes(ext) ? ext as TableFormat : null;
}

export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/** One-line, length-capped cell text without control characters. */
export function capCell(value: string, maxChars: number = MAX_PROFILE_CELL_CHARS): string {
  const flat = stripControlChars(value).replace(/\s+/g, ' ').trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

export function capRow(cells: readonly string[]): string[] {
  return cells.slice(0, MAX_PROFILE_COLUMNS).map((cell) => capCell(cell));
}

export function summarizeTableProfile(profile: TableProfile): MessageAttachmentTableSummary {
  const first = profile.sheets[0];
  return {
    ...(first?.rowCount !== undefined ? { rows: first.rowCount } : {}),
    ...(first?.columnCount !== undefined ? { columns: first.columnCount } : {}),
    ...(profile.sheets.length > 1 ? { sheets: profile.sheets.length } : {}),
  };
}

function germanCount(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? singular : plural}`;
}

/** German card meta such as "3 Blätter · 2.277 Zeilen · 13 Spalten". */
export function formatTableSummary(summary: MessageAttachmentTableSummary | undefined): string {
  if (!summary) return '';
  const parts = [
    ...(summary.sheets !== undefined && summary.sheets > 1 ? [germanCount(summary.sheets, 'Blatt', 'Blätter')] : []),
    ...(summary.rows !== undefined ? [germanCount(summary.rows, 'Zeile', 'Zeilen')] : []),
    ...(summary.columns !== undefined ? [germanCount(summary.columns, 'Spalte', 'Spalten')] : []),
  ];
  return parts.join(' · ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function asCells(value: unknown): string[] {
  return Array.isArray(value)
    ? capRow(value.map((cell) => (typeof cell === 'string' ? cell : '')))
    : [];
}

function normalizeSheet(value: unknown): TableSheetProfile | null {
  if (!isRecord(value)) return null;
  const rowCount = asCount(value.rowCount);
  const columnCount = asCount(value.columnCount);
  const rows = Array.isArray(value.rows) ? value.rows.slice(0, MAX_PREVIEW_ROWS).map(asCells) : [];
  return {
    ...(typeof value.name === 'string' ? { name: capCell(value.name) } : {}),
    ...(rowCount !== undefined ? { rowCount } : {}),
    ...(columnCount !== undefined ? { columnCount } : {}),
    ...(typeof value.range === 'string' ? { range: capCell(value.range, 24) } : {}),
    header: asCells(value.header),
    rows,
  };
}

/** Validates a profile read back from disk (drafts are untrusted input). */
export function normalizeTableProfile(value: unknown): TableProfile | undefined {
  if (!isRecord(value) || !Array.isArray(value.sheets)) return undefined;
  if (!(FORMATS as readonly unknown[]).includes(value.format)) return undefined;
  const sheets = value.sheets
    .slice(0, MAX_PROFILE_SHEETS)
    .map(normalizeSheet)
    .filter((sheet): sheet is TableSheetProfile => sheet !== null);
  return {
    format: value.format as TableFormat,
    ...((DELIMITERS as readonly unknown[]).includes(value.delimiter) ? { delimiter: value.delimiter as TableDelimiter } : {}),
    ...((ENCODINGS as readonly unknown[]).includes(value.encoding) ? { encoding: value.encoding as TableTextEncoding } : {}),
    sheets,
    ...(typeof value.note === 'string' && value.note ? { note: value.note.slice(0, MAX_NOTE_CHARS) } : {}),
  };
}
