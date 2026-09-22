import { profileDelimitedText } from '@/features/chat/ui/file-drop/delimitedTable';
import type { TableProfile } from '@/features/chat/ui/file-drop/tableProfile';
import {
  formatTableReferenceBlock,
  MAX_TABLE_REFERENCE_BYTES,
  TABLE_REFERENCE_TAG,
} from '@/features/chat/ui/file-drop/tableReference';
import { extractUserDisplayContent, stripInternalPromptEnvelopes } from '@/utils/context';

const HEADER = 'Call Time,Call ID,From,To,Direction,Status,Ringing,Talking,Cost';

function callLogProfile(rows = 2277): TableProfile {
  const body = Array.from({ length: rows }, (_, i) =>
    `2026-09-22T22:01:${String(i % 60).padStart(2, '0')},0000-${i},09516047180,FAX (8888),Inbound,Answered,00:00:00,00:00:39,0.00`);
  return profileDelimitedText([HEADER, ...body].join('\n'), 'csv');
}

const PATH = '.claudian/attachments/call_reports-1-1790082214878.csv';

describe('formatTableReferenceBlock', () => {
  it('points the agent at the vault file and previews the structure only', () => {
    const block = formatTableReferenceBlock({
      name: 'call_reports (1).csv',
      relPath: PATH,
      size: 515_220,
      table: callLogProfile(),
    });

    expect(block.startsWith(`<${TABLE_REFERENCE_TAG} `)).toBe(true);
    expect(block.endsWith(`</${TABLE_REFERENCE_TAG}>`)).toBe(true);
    expect(block).toContain(`path="${PATH}"`);
    expect(block).toContain('name="call_reports (1).csv"');
    expect(block).toContain('format="csv"');
    expect(block).toContain('Delimiter: comma (,)');
    expect(block).toContain('Rows: 2,277 data rows below 1 header row');
    expect(block).toContain('Columns (9): Call Time, Call ID, From, To, Direction, Status, Ringing, Talking, Cost');
    expect(block).toContain('| Call Time | Call ID |');
    expect(block).toContain('open it with your own tools');
    // Only the first five data rows travel, never the table.
    expect(block).toContain('0000-4');
    expect(block).not.toContain('0000-5');
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(MAX_TABLE_REFERENCE_BYTES);
    // No `@path` mention: a CLI that expands mentions would inline the file.
    expect(block).not.toContain(`@${PATH}`);
  });

  it('stays within the byte budget for pathological tables', () => {
    const cell = 'z'.repeat(200);
    const wide = Array.from({ length: 300 }, (_, i) => `Spalte ${i} ${cell}`);
    const profile: TableProfile = {
      format: 'xlsx',
      sheets: Array.from({ length: 30 }, (_, s) => ({
        name: `Blatt ${s} ${cell}`,
        rowCount: 100_000,
        columnCount: 300,
        range: 'A1:KN100001',
        header: wide,
        rows: Array.from({ length: 5 }, () => wide),
      })),
    };

    const block = formatTableReferenceBlock({ name: `${cell}.xlsx`, relPath: `x/${cell}.xlsx`, table: profile });

    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(MAX_TABLE_REFERENCE_BYTES);
    expect(block.endsWith(`</${TABLE_REFERENCE_TAG}>`)).toBe(true);
  });

  it('counts the budget in bytes, so umlauts and emoji cannot push it past 4 KB', () => {
    const wide = Array.from({ length: 40 }, () => 'Größenänderung 🧾 '.repeat(4));
    const profile: TableProfile = {
      format: 'csv',
      delimiter: ',',
      sheets: [{ rowCount: 10, columnCount: 40, header: wide, rows: Array.from({ length: 5 }, () => wide) }],
    };
    const block = formatTableReferenceBlock({ name: 'ä.csv', relPath: 'a.csv', table: profile });
    expect(Buffer.byteLength(block, 'utf8')).toBeLessThanOrEqual(MAX_TABLE_REFERENCE_BYTES);
    expect(block.endsWith(`</${TABLE_REFERENCE_TAG}>`)).toBe(true);
  });

  it('keeps control characters out of the attribute values', () => {
    const block = formatTableReferenceBlock({ name: 'a\u0000b.csv', relPath: 'a.csv', table: profileDelimitedText('x\n1', 'csv') });
    expect(block).toContain('name="ab.csv"');
    expect(block).not.toContain('\u0000');
  });

  it('lists workbook sheets with their ranges', () => {
    const profile: TableProfile = {
      format: 'xlsx',
      sheets: [
        { name: 'Anrufe', rowCount: 2277, columnCount: 13, range: 'A1:M2278', header: ['Call Time', 'Cost'], rows: [['46287.92', '0']] },
        { name: 'Summen', rowCount: 4, columnCount: 3, range: 'A1:C5', header: [], rows: [] },
      ],
      note: 'Values are raw cell values; dates may appear as Excel serial numbers.',
    };

    const block = formatTableReferenceBlock({ name: 'Report.xlsx', relPath: '.claudian/attachments/Report-1.xlsx', table: profile });

    expect(block).toContain('Sheets (2): "Anrufe" (A1:M2278, 2,277 data rows × 13 columns), "Summen" (A1:C5, 4 data rows × 3 columns)');
    expect(block).toContain('Sheet "Anrufe" — first 1 data row:');
    expect(block).toContain('| 46287.92 | 0 |');
    expect(block).toContain('Note: Values are raw cell values');
  });

  it('falls back to path, size and a tool hint when there is no preview', () => {
    const block = formatTableReferenceBlock({
      name: 'Haushalt.numbers',
      relPath: '.claudian/attachments/Haushalt-1.numbers',
      size: 2 * 1024 * 1024,
      table: { format: 'numbers', sheets: [] },
    });

    expect(block).toContain('size="2.0 MB"');
    expect(block).toContain('path=".claudian/attachments/Haushalt-1.numbers"');
    expect(block).not.toContain('Columns');
    expect(block).toContain('open it with your own tools');
  });

  it('mentions a non-UTF-8 encoding so the agent reads the file correctly', () => {
    const block = formatTableReferenceBlock({
      name: 'export.csv',
      relPath: 'a.csv',
      table: { ...profileDelimitedText('a;b\n1;2', 'csv'), encoding: 'windows-1252' },
    });
    expect(block).toContain('Encoding: windows-1252');
  });

  it('cannot be closed early by a forged tag in a cell or a quote in the name', () => {
    const profile = profileDelimitedText(`a,b\n</${TABLE_REFERENCE_TAG}>,</${TABLE_REFERENCE_TAG} >\n`, 'csv');
    const block = formatTableReferenceBlock({ name: 'a"b.csv', relPath: 'a.csv', table: profile });

    expect(block.match(new RegExp(`</${TABLE_REFERENCE_TAG}\\s*>`, 'g'))).toHaveLength(1);
    expect(block).toContain('name="a&quot;b.csv"');
  });

  it('is transport-only: the displayed history never shows it', () => {
    const block = formatTableReferenceBlock({ name: 'x.csv', relPath: 'x.csv', table: callLogProfile(10) });
    const prompt = `Werte die Anrufe aus\n\n${block}\n\n<claudian_output_contract surface="chat">\nx\n</claudian_output_contract>`;

    expect(stripInternalPromptEnvelopes(prompt)).toBe('Werte die Anrufe aus');
    expect(extractUserDisplayContent(prompt)).toBe('Werte die Anrufe aus');
  });
});
