import { buildXlsx } from '@test/helpers/xlsxFixture';

import { decodeTableText, readTableProfile } from '@/features/chat/ui/file-drop/readTableProfile';

function fileFrom(name: string, bytes: Uint8Array<ArrayBuffer> | string): File {
  return new File([bytes], name);
}

describe('decodeTableText', () => {
  it('decodes UTF-8 and falls back to windows-1252 for legacy Excel exports', () => {
    expect(decodeTableText(new TextEncoder().encode('Straße;Größe'))).toEqual({ text: 'Straße;Größe', encoding: 'utf-8' });
    const cp1252 = Uint8Array.from([0x53, 0x74, 0x72, 0x61, 0xdf, 0x65]); // "Straße" in windows-1252
    expect(decodeTableText(cp1252)).toEqual({ text: 'Straße', encoding: 'windows-1252' });
  });
});

function utf16(text: string, bigEndian: boolean): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set(bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = bigEndian ? code >> 8 : code & 0xff;
    bytes[3 + i * 2] = bigEndian ? code & 0xff : code >> 8;
  }
  return bytes;
}

describe('decodeTableText UTF-16', () => {
  it('decodes UTF-16 exports by their byte-order mark instead of leaking NUL bytes', () => {
    expect(decodeTableText(utf16('a;b\n1;2', false))).toEqual({ text: 'a;b\n1;2', encoding: 'utf-16le' });
    expect(decodeTableText(utf16('a;b', true))).toEqual({ text: 'a;b', encoding: 'utf-16be' });
  });
});

describe('readTableProfile', () => {
  it('profiles a CSV file', async () => {
    const profile = await readTableProfile(fileFrom('calls.csv', 'a,b\n1,2\n3,4\n'));
    expect(profile.format).toBe('csv');
    expect(profile.sheets[0]).toMatchObject({ header: ['a', 'b'], rowCount: 2, columnCount: 2 });
    expect(profile.encoding).toBeUndefined();
  });

  it('flags a windows-1252 CSV so the agent opens it with the right encoding', async () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('Name;Ort\nM'), 0xfc, ...new TextEncoder().encode('ller;K'), 0xf6, ...new TextEncoder().encode('ln\n')]);
    const profile = await readTableProfile(fileFrom('export.csv', bytes));
    expect(profile.encoding).toBe('windows-1252');
    expect(profile.sheets[0].rows[0]).toEqual(['Müller', 'Köln']);
  });

  it('profiles a UTF-16 CSV (Excel "Unicode text") without any NUL in the result', async () => {
    const profile = await readTableProfile(fileFrom('unicode.csv', utf16('Call Time\tCost\n2026-09-22\t0.00\n', false)));
    expect(profile.encoding).toBe('utf-16le');
    expect(profile.sheets[0].header).toEqual(['Call Time', 'Cost']);
    expect(JSON.stringify(profile)).not.toContain('\\u0000');
  });

  it('profiles an xlsx workbook', async () => {
    const profile = await readTableProfile(fileFrom('Report.xlsx', buildXlsx([{ name: 'Anrufe', rows: [['x', 'y'], [1, 2]] }])));
    expect(profile.format).toBe('xlsx');
    expect(profile.sheets[0]).toMatchObject({ name: 'Anrufe', rowCount: 1, header: ['x', 'y'] });
  });

  it('turns a broken workbook into an honest note instead of throwing', async () => {
    const profile = await readTableProfile(fileFrom('kaputt.xlsx', 'not a zip'));
    expect(profile.sheets).toEqual([]);
    expect(profile.note).toMatch(/could not be read/i);
    expect(profile.note).toMatch(/openpyxl|pandas/);
  });

  it('does not attempt legacy or Apple formats', async () => {
    const xls = await readTableProfile(fileFrom('alt.xls', 'binary'));
    expect(xls.sheets).toEqual([]);
    expect(xls.note).toMatch(/xlrd|pandas/);

    const ods = await readTableProfile(fileFrom('libre.ods', 'binary'));
    expect(ods.note).toMatch(/odf/);

    const numbers = await readTableProfile(fileFrom('Haushalt.numbers', 'binary'));
    expect(numbers).toEqual({ format: 'numbers', sheets: [] });
  });
});
