/**
 * The agent-facing stand-in for an attached table: where the file lives plus a
 * structural preview, never the table. It is transport-only — the display
 * sanitizer strips the envelope (see `SYSTEM_ENVELOPE_NAMES` in utils/context).
 */

import { escapePromptXmlAttribute, escapePromptXmlClosingTags } from '../../../../utils/promptXml';
import { formatFileSize } from './attachmentMeta';
import type { TableDelimiter, TableProfile, TableSheetProfile } from './tableProfile';

export const TABLE_REFERENCE_TAG = 'claudian_attachment';
/**
 * Hard ceiling per attached table. Five rows of a wide export fit comfortably;
 * anything beyond belongs in the file the agent can open, not in every prompt,
 * transcript, and replayed history of the conversation.
 */
export const MAX_TABLE_REFERENCE_BYTES = 4096;
const MAX_REFERENCE_ROW_CHARS = 400;
const MAX_NAME_ATTRIBUTE_CHARS = 160;

export interface TableReferenceInput {
  name: string;
  relPath: string;
  size?: number;
  table: TableProfile;
}

interface RenderBudget {
  rows: number;
  columns: number;
  cellChars: number;
  sheets: number;
}

// Tried in order until the block fits; each step trades detail for room.
const BUDGETS: readonly RenderBudget[] = [
  { rows: 5, columns: 40, cellChars: 40, sheets: 32 },
  { rows: 3, columns: 20, cellChars: 32, sheets: 12 },
  { rows: 1, columns: 12, cellChars: 24, sheets: 6 },
  { rows: 0, columns: 12, cellChars: 24, sheets: 4 },
  { rows: 0, columns: 0, cellChars: 24, sheets: 1 },
];

const DELIMITER_NAMES: Record<TableDelimiter, string> = {
  ',': 'comma (,)',
  ';': 'semicolon (;)',
  '\t': 'tab',
  '|': 'pipe (|)',
};

const INSTRUCTION = 'The full table is NOT included in this message. It is saved in the vault at the path above; '
  + 'open it with your own tools (e.g. Python pandas) for anything beyond this preview.';

function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value.toLocaleString('en-US')} ${value === 1 ? singular : plural}`;
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(1, maxChars - 1))}…` : value;
}

function listNames(names: readonly string[], limit: number, cellChars: number): string {
  const shown = names.slice(0, limit).map((name) => clip(name, cellChars));
  const hidden = names.length - shown.length;
  return hidden > 0 ? `${shown.join(', ')}, … (+${hidden} more)` : shown.join(', ');
}

function markdownRow(cells: readonly string[], budget: RenderBudget): string {
  const line = `| ${cells.slice(0, budget.columns).map((cell) => clip(cell, budget.cellChars).replace(/\|/g, '\\|')).join(' | ')} |`;
  return clip(line, MAX_REFERENCE_ROW_CHARS);
}

function previewTable(sheet: TableSheetProfile, budget: RenderBudget): string[] {
  const rows = sheet.rows.slice(0, budget.rows);
  if (rows.length === 0 || sheet.header.length === 0 || budget.columns === 0) return [];
  const width = Math.min(budget.columns, Math.max(sheet.header.length, ...rows.map((row) => row.length)));
  const header = Array.from({ length: width }, (_, i) => sheet.header[i] ?? '');
  return [
    markdownRow(header, budget),
    clip(`|${' --- |'.repeat(width)}`, MAX_REFERENCE_ROW_CHARS),
    ...rows.map((row) => markdownRow(Array.from({ length: width }, (_, i) => row[i] ?? ''), budget)),
  ];
}

function columnCount(sheet: TableSheetProfile): number {
  return sheet.columnCount ?? sheet.header.length;
}

function describeSheet(sheet: TableSheetProfile, budget: RenderBudget): string {
  const columns = columnCount(sheet);
  let dims = '';
  if (sheet.rowCount !== undefined && columns > 0) dims = `${count(sheet.rowCount, 'data row')} × ${count(columns, 'column')}`;
  else if (sheet.rowCount !== undefined) dims = count(sheet.rowCount, 'data row');
  else if (columns > 0) dims = `${count(columns, 'column')}, row count unknown`;
  const parts = [sheet.range, dims].filter((part): part is string => !!part);
  const name = `"${clip(sheet.name ?? 'Sheet', budget.cellChars)}"`;
  return parts.length ? `${name} (${parts.join(', ')})` : name;
}

function delimitedBody(sheet: TableSheetProfile | undefined, budget: RenderBudget): string[] {
  if (!sheet) return [];
  const rows = sheet.rowCount === undefined
    ? 'Rows: unknown'
    : `Rows: ${count(sheet.rowCount, 'data row')} below 1 header row`;
  const lines = [rows];
  if (sheet.header.length > 0 && budget.columns > 0) {
    lines.push(`Columns (${columnCount(sheet).toLocaleString('en-US')}): ${listNames(sheet.header, budget.columns, budget.cellChars)}`);
  }
  const table = previewTable(sheet, budget);
  if (table.length > 0) lines.push(`First ${count(table.length - 2, 'data row')}:`, ...table);
  return lines;
}

function workbookBody(sheets: readonly TableSheetProfile[], budget: RenderBudget): string[] {
  if (sheets.length === 0) return [];
  const listed = sheets.slice(0, budget.sheets).map((sheet) => describeSheet(sheet, budget));
  const hidden = sheets.length - listed.length;
  const lines = [`Sheets (${sheets.length}): ${listed.join(', ')}${hidden > 0 ? `, … (+${hidden} more)` : ''}`];
  for (const sheet of sheets) {
    const table = previewTable(sheet, budget);
    if (table.length === 0) continue;
    lines.push(`Sheet "${clip(sheet.name ?? 'Sheet', budget.cellChars)}" — first ${count(table.length - 2, 'data row')}:`, ...table);
  }
  return lines;
}

function openingTag(input: TableReferenceInput): string {
  const attributes = [
    'kind="table"',
    `name="${escapePromptXmlAttribute(clip(input.name, MAX_NAME_ATTRIBUTE_CHARS))}"`,
    `path="${escapePromptXmlAttribute(input.relPath)}"`,
    `format="${input.table.format}"`,
    ...(input.size !== undefined ? [`size="${formatFileSize(input.size)}"`] : []),
  ];
  return `<${TABLE_REFERENCE_TAG} ${attributes.join(' ')}>`;
}

function renderBody(table: TableProfile, budget: RenderBudget): string {
  const isDelimited = table.format === 'csv' || table.format === 'tsv';
  const lines = [
    INSTRUCTION,
    ...(table.delimiter ? [`Delimiter: ${DELIMITER_NAMES[table.delimiter]}`] : []),
    ...(table.encoding ? [`Encoding: ${table.encoding} (not UTF-8)`] : []),
    ...(isDelimited ? delimitedBody(table.sheets[0], budget) : workbookBody(table.sheets, budget)),
    ...(table.note ? [`Note: ${table.note}`] : []),
  ];
  return escapePromptXmlClosingTags(lines.join('\n'), TABLE_REFERENCE_TAG);
}

function trimUtf8(value: string, maxBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
}

/** Bounded reference block for one attached table (≤ {@link MAX_TABLE_REFERENCE_BYTES}). */
export function formatTableReferenceBlock(input: TableReferenceInput): string {
  const open = openingTag(input);
  const close = `</${TABLE_REFERENCE_TAG}>`;
  let body = '';
  for (const budget of BUDGETS) {
    body = renderBody(input.table, budget);
    if (Buffer.byteLength(`${open}\n${body}\n${close}`, 'utf8') <= MAX_TABLE_REFERENCE_BYTES) {
      return `${open}\n${body}\n${close}`;
    }
  }
  const room = Math.max(0, MAX_TABLE_REFERENCE_BYTES - Buffer.byteLength(`${open}\n…\n${close}`, 'utf8'));
  return `${open}\n${trimUtf8(body, room)}…\n${close}`;
}
