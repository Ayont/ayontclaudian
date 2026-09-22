import {
  detectPastedTableDelimiter,
  profileDelimitedText,
  sniffDelimiter,
} from '@/features/chat/ui/file-drop/delimitedTable';
import { MAX_PREVIEW_ROWS, MAX_PROFILE_COLUMNS } from '@/features/chat/ui/file-drop/tableProfile';

const CALL_HEADER = 'Call Time,Call ID,From,To,Direction,Status,Ringing,Talking,Cost';

function callLog(rows: number): string {
  const body = Array.from({ length: rows }, (_, i) =>
    `2026-09-22T10:${String(i % 60).padStart(2, '0')}:00,id-${i},"Hoehne, Info (83${i % 10})",0211${i},Inbound,Answered,00:00:0${i % 10},00:01:12,0.00`);
  return [CALL_HEADER, ...body].join('\n') + '\n';
}

describe('sniffDelimiter', () => {
  it('detects commas, semicolons, tabs and pipes', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6')).toBe(',');
    expect(sniffDelimiter('Name;Preis;Menge\nApfel;1,50;3\nBirne;2,00;1')).toBe(';');
    expect(sniffDelimiter('a\tb\n1\t2\n3\t4')).toBe('\t');
    expect(sniffDelimiter('a|b\n1|2\n3|4')).toBe('|');
  });

  it('ignores delimiters inside quoted fields', () => {
    const text = 'name;city\n"Muster, Max";Köln\n"Doe, Jane";Bonn\n"A, B";Essen';
    expect(sniffDelimiter(text)).toBe(';');
  });

  it('returns null for single-column text', () => {
    expect(sniffDelimiter('just\nwords\nhere')).toBeNull();
  });
});

describe('profileDelimitedText', () => {
  it('profiles the reported 3CX call log without holding the whole table', () => {
    const profile = profileDelimitedText(callLog(2277), 'csv');

    expect(profile.format).toBe('csv');
    expect(profile.delimiter).toBe(',');
    expect(profile.sheets).toHaveLength(1);
    const [sheet] = profile.sheets;
    expect(sheet.header).toEqual(CALL_HEADER.split(','));
    expect(sheet.columnCount).toBe(9);
    expect(sheet.rowCount).toBe(2277);
    expect(sheet.rows).toHaveLength(MAX_PREVIEW_ROWS);
    // Quoted commas stay inside their cell.
    expect(sheet.rows[0][2]).toBe('Hoehne, Info (830)');
  });

  it('strips a byte-order mark and handles CRLF plus blank trailing lines', () => {
    const profile = profileDelimitedText('﻿a;b\r\n1;2\r\n3;4\r\n\r\n', 'csv');
    const [sheet] = profile.sheets;
    expect(profile.delimiter).toBe(';');
    expect(sheet.header).toEqual(['a', 'b']);
    expect(sheet.rowCount).toBe(2);
  });

  it('counts a quoted field with embedded line breaks as one row', () => {
    const text = 'id,note\n1,"first line\nsecond line"\n2,"he said ""hi"""\n';
    const [sheet] = profileDelimitedText(text, 'csv').sheets;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.rows[0]).toEqual(['1', 'first line second line']);
    expect(sheet.rows[1]).toEqual(['2', 'he said "hi"']);
  });

  it('treats a quote in the middle of a field as a literal character', () => {
    const text = 'item,size\nMonitor,27" wide\nKabel,2m\n';
    const [sheet] = profileDelimitedText(text, 'csv').sheets;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.rows[0]).toEqual(['Monitor', '27" wide']);
  });

  it('uses tabs for .tsv files', () => {
    const profile = profileDelimitedText('a,x\tb\n1,y\t2\n', 'tsv');
    expect(profile.delimiter).toBe('\t');
    expect(profile.sheets[0].header).toEqual(['a,x', 'b']);
  });

  it('caps very wide tables but reports the true column count', () => {
    const header = Array.from({ length: 120 }, (_, i) => `c${i}`).join(',');
    const row = Array.from({ length: 120 }, (_, i) => `${i}`).join(',');
    const [sheet] = profileDelimitedText(`${header}\n${row}\n`, 'csv').sheets;
    expect(sheet.columnCount).toBe(120);
    expect(sheet.header).toHaveLength(MAX_PROFILE_COLUMNS);
    expect(sheet.rows[0]).toHaveLength(MAX_PROFILE_COLUMNS);
  });

  it('leaves the row count open when only a prefix was scanned', () => {
    const [sheet] = profileDelimitedText(callLog(20), 'csv', { complete: false }).sheets;
    expect(sheet.rowCount).toBeUndefined();
    expect(sheet.rows).toHaveLength(MAX_PREVIEW_ROWS);
  });

  it('does not claim an exact row count when the file ends inside a quoted field', () => {
    const profile = profileDelimitedText('id,note\n1,"ok"\n2,"never closed\n3,x\n', 'csv');
    expect(profile.sheets[0].rowCount).toBeUndefined();
    expect(profile.note).toMatch(/quoted field/);
  });

  it('honours an Excel "sep=" hint line and skips it', () => {
    const profile = profileDelimitedText('sep=;\nName,Vorname;Ort\nMuster, Max;Köln\n', 'csv');
    expect(profile.delimiter).toBe(';');
    expect(profile.sheets[0].header).toEqual(['Name,Vorname', 'Ort']);
    expect(profile.sheets[0].rowCount).toBe(1);
  });

  it('describes an empty file honestly', () => {
    const profile = profileDelimitedText('', 'csv');
    expect(profile.sheets[0].rowCount).toBe(0);
    expect(profile.sheets[0].header).toEqual([]);
  });
});

describe('detectPastedTableDelimiter', () => {
  it('recognizes a pasted CSV and an Excel selection (TSV)', () => {
    expect(detectPastedTableDelimiter(callLog(30))).toBe(',');
    const excel = Array.from({ length: 12 }, (_, i) => `Zeile ${i}\t${i}\t${i * 2}`).join('\n');
    expect(detectPastedTableDelimiter(excel)).toBe('\t');
  });

  it('does not mistake prose, code or JSON for a table', () => {
    const prose = Array.from({ length: 12 }, (_, i) =>
      i % 2 ? 'Hallo, das ist ein Satz, mit Kommas.' : 'Noch ein Satz ohne viel, Struktur').join('\n');
    expect(detectPastedTableDelimiter(prose)).toBeNull();
    const json = JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ a: i, b: i, c: i })), null, 2);
    expect(detectPastedTableDelimiter(json)).toBeNull();
    const code = Array.from({ length: 12 }, (_, i) => `  call(a${i}, b${i});`).join('\n');
    expect(detectPastedTableDelimiter(code)).toBeNull();
  });

  it('does not read indented stack traces, JS arrays or Markdown tables as tables', () => {
    const trace = ['java.lang.IllegalStateException: boom', ...Array.from({ length: 600 }, (_, i) =>
      `\tat com.example.service.Handler${i}.handle(Handler${i}.java:${i + 10})`)].join('\n');
    expect(detectPastedTableDelimiter(trace)).toBeNull();
    const jsArray = ['const rows = [', ...Array.from({ length: 40 }, (_, i) => `  [${i}, ${i + 1}, ${i + 2}],`), '];'].join('\n');
    expect(detectPastedTableDelimiter(jsArray)).toBeNull();
    const markdown = ['| a | b | c |', '| --- | --- | --- |', ...Array.from({ length: 30 }, (_, i) => `| ${i}, x | ${i}, y | ${i}, z |`)].join('\n');
    expect(detectPastedTableDelimiter(markdown)).toBeNull();
  });

  it('needs a handful of lines before calling it a table', () => {
    expect(detectPastedTableDelimiter('a,b,c\n1,2,3\n4,5,6')).toBeNull();
  });
});
