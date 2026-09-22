import { buildXlsx, buildZip } from '@test/helpers/xlsxFixture';

import { MAX_PREVIEW_ROWS, MAX_PROFILE_COLUMNS } from '@/features/chat/ui/file-drop/tableProfile';
import { readXlsxProfile } from '@/features/chat/ui/file-drop/xlsxReader';

const HEADER = ['Call Time', 'Call ID', 'From', 'To', 'Cost'];

function callRows(count: number): (string | number)[][] {
  return Array.from({ length: count }, (_, i) => [46287.5 + i, `id-${i}`, '09516047180', `FAX (${8000 + i})`, i * 0.1]);
}

describe('readXlsxProfile', () => {
  it('reads sheet names, ranges, header and the first rows via shared strings', () => {
    const bytes = buildXlsx([
      { name: 'Anrufe', rows: [HEADER, ...callRows(12)] },
      { name: 'Summen', rows: [['Typ', 'Anzahl'], ['Inbound', 7], ['Outbound', 5]] },
    ]);

    const profile = readXlsxProfile(bytes);

    expect(profile.format).toBe('xlsx');
    expect(profile.sheets.map((sheet) => sheet.name)).toEqual(['Anrufe', 'Summen']);
    const [calls, totals] = profile.sheets;
    expect(calls.range).toBe('A1:E13');
    expect(calls.rowCount).toBe(12);
    expect(calls.columnCount).toBe(5);
    expect(calls.header).toEqual(HEADER);
    expect(calls.rows).toHaveLength(MAX_PREVIEW_ROWS);
    expect(calls.rows[0]).toEqual(['46287.5', 'id-0', '09516047180', 'FAX (8000)', '0']);
    expect(totals.rowCount).toBe(2);
    expect(totals.rows).toEqual([['Inbound', '7'], ['Outbound', '5']]);
    expect(profile.note).toMatch(/serial numbers/);
  });

  it('handles inline strings, booleans, sparse cells and XML entities', () => {
    const bytes = buildXlsx([{
      name: 'Daten',
      inlineStrings: true,
      rows: [['A & B', null, 'C <x>'], [true, 1, false]],
    }]);

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.header).toEqual(['A & B', '', 'C <x>']);
    expect(sheet.rows[0]).toEqual(['TRUE', '1', 'FALSE']);
  });

  it('joins rich-text runs and skips phonetic hints in shared strings', () => {
    const sheet = '<worksheet><dimension ref="A1:A2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>';
    const bytes = buildZip([
      { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/sharedStrings.xml', data: '<sst><si><r><t>Hallo </t></r><r><t>Welt</t></r></si><si><t>東京</t><rPh><t>トウキョウ</t></rPh></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);

    const [profiled] = readXlsxProfile(bytes).sheets;

    expect(profiled.header).toEqual(['Hallo Welt']);
    expect(profiled.rows).toEqual([['東京']]);
  });

  it('counts rows itself when the producer wrote no dimension', () => {
    const bytes = buildXlsx([{ name: 'Export', dimension: null, rows: [HEADER, ...callRows(7)] }]);

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.range).toBeUndefined();
    expect(sheet.rowCount).toBe(7);
    expect(sheet.columnCount).toBe(5);
  });

  it('reads stored (uncompressed) archives and absolute relationship targets', () => {
    const bytes = buildXlsx([{ name: 'Tab', rows: [['x'], ['1']] }], { store: true, absoluteRelTargets: true });

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.header).toEqual(['x']);
    expect(sheet.rows).toEqual([['1']]);
  });

  it('previews a huge sheet from a compressed prefix and trusts its dimension for the count', () => {
    const bytes = buildXlsx([{ name: 'Groß', rows: [HEADER, ...callRows(20_000)] }]);

    const [sheet] = readXlsxProfile(bytes, { maxSheetCompressedBytes: 4096 }).sheets;

    expect(sheet.rowCount).toBe(20_000);
    expect(sheet.header).toEqual(HEADER);
    expect(sheet.rows).toHaveLength(MAX_PREVIEW_ROWS);
  });

  it('leaves the row count open when neither a dimension nor the whole sheet is available', () => {
    const bytes = buildXlsx([{ name: 'Groß', dimension: null, rows: [HEADER, ...callRows(20_000)] }]);

    const [sheet] = readXlsxProfile(bytes, { maxSheetCompressedBytes: 4096 }).sheets;

    expect(sheet.rowCount).toBeUndefined();
    expect(sheet.rows).toHaveLength(MAX_PREVIEW_ROWS);
  });

  function rawWorkbook(sheetXml: string, sharedStrings?: string, workbookXml?: string): Uint8Array<ArrayBuffer> {
    return buildZip([
      { name: 'xl/workbook.xml', data: workbookXml ?? '<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
      ...(sharedStrings ? [{ name: 'xl/sharedStrings.xml', data: sharedStrings }] : []),
      { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    ]);
  }

  it('ignores a crafted cell reference far beyond the Excel grid instead of allocating it', () => {
    const bytes = rawWorkbook('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="ZZZZZZZ1"><v>1</v></c></row></sheetData></worksheet>');

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.header).toEqual(['a']);
    expect(sheet.columnCount).toBe(1);
  });

  it('counts a far but valid column without materializing the gap', () => {
    const bytes = rawWorkbook('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="XFD1"><v>1</v></c></row></sheetData></worksheet>');

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.columnCount).toBe(16384);
    expect(sheet.header.length).toBeLessThanOrEqual(MAX_PROFILE_COLUMNS);
  });

  it('does not trust a placeholder dimension that the rows exceed', () => {
    const bytes = buildXlsx([{ name: 'Export', dimension: 'A1', rows: [HEADER, ...callRows(6)] }]);

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet.range).toBeUndefined();
    expect(sheet.rowCount).toBe(6);
    expect(sheet.columnCount).toBe(5);
  });

  it('trusts a range that does not start at A1', () => {
    const bytes = rawWorkbook('<worksheet><dimension ref="B2:C4"/><sheetData>'
      + '<row r="2"><c r="B2" t="inlineStr"><is><t>x</t></is></c><c r="C2" t="inlineStr"><is><t>y</t></is></c></row>'
      + '<row r="3"><c r="B3"><v>1</v></c><c r="C3"><v>2</v></c></row>'
      + '</sheetData></worksheet>');

    const [sheet] = readXlsxProfile(bytes).sheets;

    expect(sheet).toMatchObject({ range: 'B2:C4', rowCount: 2, columnCount: 2 });
  });

  it('reads namespace-prefixed and single-quoted SpreadsheetML', () => {
    const sheet = "<x:worksheet><x:dimension ref='A1:B3'/><x:sheetData>"
      + "<x:row r='1'><x:c r='A1' t='s'><x:v>0</x:v></x:c><x:c r='B1' t='s'><x:v>1</x:v></x:c></x:row>"
      + "<x:row r='2'><x:c r='A2'><x:v>7</x:v></x:c><x:c r='B2' t='s'><x:v>2</x:v></x:c></x:row>"
      + "<x:row r='3'><x:c r='A3'><x:v>8</x:v></x:c></x:row>"
      + '</x:sheetData></x:worksheet>';
    const strings = '<x:sst><x:si><x:t>Menge</x:t></x:si><x:si><x:t>Artikel</x:t></x:si><x:si><x:t>Kabel</x:t></x:si></x:sst>';
    const workbook = "<x:workbook><x:sheets><x:sheet name='Lager' sheetId='1' r:id='rId1'/></x:sheets></x:workbook>";

    const profile = readXlsxProfile(rawWorkbook(sheet, strings, workbook));

    expect(profile.sheets[0]).toMatchObject({
      name: 'Lager',
      range: 'A1:B3',
      rowCount: 2,
      columnCount: 2,
      header: ['Menge', 'Artikel'],
      rows: [['7', 'Kabel'], ['8']],
    });
  });

  it('rejects files that are not zip archives', () => {
    expect(() => readXlsxProfile(new TextEncoder().encode('Call Time,Call ID\n1,2'))).toThrow();
  });

  it('rejects a zip that is not a workbook', () => {
    const bytes = buildZip([{ name: 'readme.txt', data: 'hi' }]);
    expect(() => readXlsxProfile(bytes)).toThrow(/workbook/);
  });
});
