import {
  LibrarySearchIndex,
  type LibrarySearchSource,
  parseLibraryQuery,
  splitHighlight,
} from '@/features/chat/ui/library/libraryIndex';

interface Item {
  id: string;
  source: LibrarySearchSource;
}

const item = (id: string, name: string, folder = '', kind: LibrarySearchSource['kind'] = 'generic'): Item => ({
  id,
  source: { name, folder, kind },
});

function createIndex() {
  const describe = jest.fn((entry: Item) => entry.source);
  return { index: new LibrarySearchIndex<Item>(describe), describe };
}

const ITEMS: Item[] = [
  item('1', 'Größenübersicht Straße.pdf', 'Projekte/Außendienst', 'pdf'),
  item('2', 'CERTUSS - CodeTwo Signatur.docx', 'Kunden/CERTUSS', 'doc'),
  item('3', 'urlaub-strand.png', 'Bilder/2026', 'image'),
  item('4', 'Budget 2026.xlsx', 'Finanzen', 'sheet'),
  item('5', 'Strategie Q3', '.claudian/documents', 'document'),
];

describe('parseLibraryQuery', () => {
  it('normalizes case, accents and ß and splits on whitespace', () => {
    expect(parseLibraryQuery('  GRÖSSE   Straße ')).toEqual(['grosse', 'strasse']);
    expect(parseLibraryQuery('   ')).toEqual([]);
  });
});

describe('LibrarySearchIndex', () => {
  it('returns every item without highlights for an empty query', () => {
    const { index } = createIndex();
    const result = index.search(ITEMS, '');
    expect(result.total).toBe(5);
    expect(result.matches.map((match) => match.item.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(result.matches.every((match) => match.nameRanges.length === 0)).toBe(true);
  });

  it('matches names case-, accent- and ß-insensitively', () => {
    const { index } = createIndex();
    expect(index.search(ITEMS, 'grösse').matches.map((m) => m.item.id)).toEqual(['1']);
    expect(index.search(ITEMS, 'STRASSE').matches.map((m) => m.item.id)).toEqual(['1']);
    expect(index.search(ITEMS, 'certuss').matches.map((m) => m.item.id)).toEqual(['2']);
  });

  it('requires every word to match, across name, folder and type', () => {
    const { index } = createIndex();
    expect(index.search(ITEMS, 'certuss signatur').matches.map((m) => m.item.id)).toEqual(['2']);
    expect(index.search(ITEMS, 'außendienst pdf').matches.map((m) => m.item.id)).toEqual(['1']);
    expect(index.search(ITEMS, 'certuss pdf').matches).toHaveLength(0);
  });

  it('maps German type words to kinds by prefix', () => {
    const { index } = createIndex();
    expect(index.search(ITEMS, 'bild').matches.map((m) => m.item.id)).toEqual(['3']);
    expect(index.search(ITEMS, 'tab').matches.map((m) => m.item.id)).toEqual(['4']);
    expect(index.search(ITEMS, 'excel').matches.map((m) => m.item.id)).toEqual(['4']);
    expect(index.search(ITEMS, 'präsentation').matches).toHaveLength(0);
    expect(index.search(ITEMS, 'entwurf').matches.map((m) => m.item.id)).toEqual(['5']);
  });

  it('highlights name and folder matches in the original spelling', () => {
    const { index } = createIndex();
    const [match] = index.search(ITEMS, 'strasse aussen').matches;
    const name = ITEMS[0].source.name;
    const folder = ITEMS[0].source.folder;
    expect(match.nameRanges.map(([start, end]) => name.slice(start, end))).toEqual(['Straße']);
    expect(match.folderRanges.map(([start, end]) => folder.slice(start, end))).toEqual(['Außen']);
  });

  it('merges overlapping highlight ranges', () => {
    const { index } = createIndex();
    const [match] = index.search(ITEMS, 'budget udg').matches;
    const name = ITEMS[3].source.name;
    expect(match.nameRanges.map(([start, end]) => name.slice(start, end))).toEqual(['Budget']);
  });

  it('keeps the library order instead of reshuffling rows while typing', () => {
    const { index } = createIndex();
    expect(index.search(ITEMS, 'st').matches.map((m) => m.item.id)).toEqual(['1', '3', '5']);
  });

  it('normalizes each item once, no matter how many keystrokes follow', () => {
    const { index, describe } = createIndex();
    for (const query of ['s', 'st', 'str', 'stra', 'straß', 'straße']) index.search(ITEMS, query);
    expect(describe).toHaveBeenCalledTimes(ITEMS.length);
  });

  it('re-indexes an item when it is replaced by a new object', () => {
    const { index, describe } = createIndex();
    const items = [...ITEMS];
    index.search(items, 'x');
    items[0] = item('1', 'Neuer Name.pdf', 'Projekte', 'pdf');
    expect(index.search(items, 'neuer').matches.map((m) => m.item.id)).toEqual(['1']);
    expect(describe).toHaveBeenCalledTimes(ITEMS.length + 1);
  });
});

describe('splitHighlight', () => {
  it('splits text into plain and highlighted segments', () => {
    expect(splitHighlight('Budget 2026.xlsx', [[0, 6], [7, 11]])).toEqual([
      { text: 'Budget', highlighted: true },
      { text: ' ', highlighted: false },
      { text: '2026', highlighted: true },
      { text: '.xlsx', highlighted: false },
    ]);
  });

  it('returns the whole text as one plain segment without ranges', () => {
    expect(splitHighlight('Bericht.pdf', [])).toEqual([{ text: 'Bericht.pdf', highlighted: false }]);
  });
});
