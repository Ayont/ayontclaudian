import { crc32, deflateRawSync } from 'zlib';

export interface ZipFixtureEntry {
  name: string;
  data: string | Buffer;
  /** Store instead of deflate (method 0). */
  store?: boolean;
}

/** Minimal, valid ZIP writer so tests exercise the reader against real archives. */
export function buildZip(entries: ZipFixtureEntry[]): Uint8Array<ArrayBuffer> {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const packed = entry.store ? raw : deflateRawSync(raw);
    const method = entry.store ? 0 : 8;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + packed.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, centralDir, end]));
}

export type XlsxCell = string | number | boolean | null;

export interface XlsxFixtureSheet {
  name: string;
  rows: XlsxCell[][];
  /** `null` omits the <dimension> element; a string overrides it. */
  dimension?: string | null;
  /** Write strings inline instead of into sharedStrings.xml. */
  inlineStrings?: boolean;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Builds an .xlsx workbook with shared strings, the way Excel writes it. */
export function buildXlsx(
  sheets: XlsxFixtureSheet[],
  options: { absoluteRelTargets?: boolean; store?: boolean } = {},
): Uint8Array<ArrayBuffer> {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const intern = (value: string): number => {
    const known = sharedIndex.get(value);
    if (known !== undefined) return known;
    shared.push(value);
    sharedIndex.set(value, shared.length - 1);
    return shared.length - 1;
  };

  const sheetXml = sheets.map((sheet) => {
    const width = Math.max(1, ...sheet.rows.map((row) => row.length));
    const dimension = sheet.dimension === undefined
      ? `<dimension ref="A1:${columnLetters(width - 1)}${Math.max(1, sheet.rows.length)}"/>`
      : sheet.dimension === null ? '' : `<dimension ref="${sheet.dimension}"/>`;
    const rows = sheet.rows.map((row, r) => {
      const cells = row.map((value, c) => {
        const ref = `${columnLetters(c)}${r + 1}`;
        if (value === null) return '';
        if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
        if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
        if (sheet.inlineStrings) return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        return `<c r="${ref}" t="s"><v>${intern(value)}</v></c>`;
      }).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}<sheetData>${rows}</sheetData></worksheet>`;
  });

  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
    sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
  }</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships>${
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${options.absoluteRelTargets ? '/xl/' : ''}worksheets/sheet${i + 1}.xml"/>`).join('')
  }<Relationship Id="rIdS" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const sharedXml = `<?xml version="1.0" encoding="UTF-8"?><sst count="${shared.length}">${
    shared.map((value) => `<si><t xml:space="preserve">${escapeXml(value)}</t></si>`).join('')
  }</sst>`;

  const store = options.store === true;
  return buildZip([
    { name: '[Content_Types].xml', data: '<Types/>', store },
    { name: 'xl/workbook.xml', data: workbook, store },
    { name: 'xl/_rels/workbook.xml.rels', data: rels, store },
    ...(shared.length > 0 ? [{ name: 'xl/sharedStrings.xml', data: sharedXml, store }] : []),
    ...sheetXml.map((xml, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml, store })),
  ]);
}
