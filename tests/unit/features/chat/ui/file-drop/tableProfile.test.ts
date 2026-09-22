import {
  capCell,
  formatTableSummary,
  MAX_PREVIEW_ROWS,
  MAX_PROFILE_CELL_CHARS,
  MAX_PROFILE_COLUMNS,
  MAX_PROFILE_SHEETS,
  normalizeTableProfile,
  summarizeTableProfile,
  tableFormatForFile,
  type TableProfile,
} from '@/features/chat/ui/file-drop/tableProfile';

describe('tableFormatForFile', () => {
  it('recognizes every spreadsheet and delimited-table format case-insensitively', () => {
    expect(tableFormatForFile('call_reports (1).csv')).toBe('csv');
    expect(tableFormatForFile('export.TSV')).toBe('tsv');
    expect(tableFormatForFile('Budget 2026.xlsx')).toBe('xlsx');
    expect(tableFormatForFile('alt.xls')).toBe('xls');
    expect(tableFormatForFile('libre.ods')).toBe('ods');
    expect(tableFormatForFile('Haushalt.numbers')).toBe('numbers');
    expect(tableFormatForFile('/Users/x/Downloads/event_logs.csv')).toBe('csv');
  });

  it('leaves other files alone', () => {
    expect(tableFormatForFile('notes.txt')).toBeNull();
    expect(tableFormatForFile('data.json')).toBeNull();
    expect(tableFormatForFile('csv')).toBeNull();
    expect(tableFormatForFile('archive.csv.zip')).toBeNull();
  });
});

describe('capCell', () => {
  it('flattens line breaks and caps long values with an ellipsis', () => {
    expect(capCell('  Max\r\nMustermann  ')).toBe('Max Mustermann');
    const capped = capCell('x'.repeat(500));
    expect(capped).toHaveLength(MAX_PROFILE_CELL_CHARS);
    expect(capped.endsWith('…')).toBe(true);
  });
});

describe('capCell control characters', () => {
  it('never lets NUL or other control characters through', () => {
    expect(capCell('a\u0000b\u0007c\td\u001be\u0085f')).toBe('abc def');
  });
});

describe('summarizeTableProfile', () => {
  it('reports rows and columns of the first sheet plus the sheet count', () => {
    const profile: TableProfile = {
      format: 'xlsx',
      sheets: [
        { name: 'Anrufe', rowCount: 2277, columnCount: 13, header: [], rows: [] },
        { name: 'Summen', rowCount: 4, columnCount: 3, header: [], rows: [] },
      ],
    };
    expect(summarizeTableProfile(profile)).toEqual({ rows: 2277, columns: 13, sheets: 2 });
  });

  it('omits what is unknown', () => {
    expect(summarizeTableProfile({ format: 'xls', sheets: [] })).toEqual({});
    expect(summarizeTableProfile({
      format: 'csv',
      sheets: [{ columnCount: 4, header: [], rows: [] }],
    })).toEqual({ columns: 4 });
  });
});

describe('formatTableSummary', () => {
  it('formats German counts with thousands separators', () => {
    expect(formatTableSummary({ rows: 2277, columns: 9 })).toBe('2.277 Zeilen · 9 Spalten');
  });

  it('uses singular forms and mentions multiple sheets first', () => {
    expect(formatTableSummary({ rows: 1, columns: 1 })).toBe('1 Zeile · 1 Spalte');
    expect(formatTableSummary({ rows: 12, columns: 3, sheets: 3 })).toBe('3 Blätter · 12 Zeilen · 3 Spalten');
    expect(formatTableSummary({ rows: 12, columns: 3, sheets: 1 })).toBe('12 Zeilen · 3 Spalten');
  });

  it('returns an empty string when nothing is known', () => {
    expect(formatTableSummary(undefined)).toBe('');
    expect(formatTableSummary({})).toBe('');
  });
});

describe('normalizeTableProfile', () => {
  it('keeps a well-formed profile', () => {
    const profile: TableProfile = {
      format: 'csv',
      delimiter: ';',
      encoding: 'windows-1252',
      sheets: [{ rowCount: 3, columnCount: 2, header: ['a', 'b'], rows: [['1', '2']] }],
      note: 'hinweis',
    };
    expect(normalizeTableProfile(profile)).toEqual(profile);
  });

  it('rejects anything that is not a profile', () => {
    expect(normalizeTableProfile(null)).toBeUndefined();
    expect(normalizeTableProfile('csv')).toBeUndefined();
    expect(normalizeTableProfile({ format: 'exe', sheets: [] })).toBeUndefined();
    expect(normalizeTableProfile({ format: 'csv', sheets: 'nope' })).toBeUndefined();
  });

  it('clamps untrusted sizes so a stored draft stays bounded', () => {
    const wide = Array.from({ length: 500 }, (_, i) => `col-${i}-${'y'.repeat(200)}`);
    const normalized = normalizeTableProfile({
      format: 'xlsx',
      delimiter: 'x',
      sheets: Array.from({ length: 200 }, () => ({
        name: 'n'.repeat(500),
        rowCount: -4,
        columnCount: 1.5,
        header: wide,
        rows: Array.from({ length: 50 }, () => wide),
      })),
    });

    expect(normalized).toBeDefined();
    expect(normalized!.delimiter).toBeUndefined();
    expect(normalized!.sheets).toHaveLength(MAX_PROFILE_SHEETS);
    const first = normalized!.sheets[0];
    expect(first.rowCount).toBeUndefined();
    expect(first.columnCount).toBeUndefined();
    expect(first.header).toHaveLength(MAX_PROFILE_COLUMNS);
    expect(first.rows).toHaveLength(MAX_PREVIEW_ROWS);
    expect(first.rows[0]).toHaveLength(MAX_PROFILE_COLUMNS);
    expect(first.header[0].length).toBeLessThanOrEqual(MAX_PROFILE_CELL_CHARS);
    expect(first.name!.length).toBeLessThanOrEqual(MAX_PROFILE_CELL_CHARS);
  });
});
