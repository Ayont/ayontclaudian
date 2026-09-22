/**
 * Library search: pure, so matching and highlighting are testable without the DOM.
 *
 * Each item is normalized once into a cached entry; a keystroke only normalizes
 * the query and scans the precomputed strings (O(n) over short fields). Every
 * query word must match the name, the folder path, or a type word.
 */

import { type AttachmentKind, attachmentKindLabel } from '../file-drop/attachmentMeta';
import { normalizeForSearch, normalizeWithMap } from '../historySearch';

export type LibraryKind = AttachmentKind | 'document';

export interface LibrarySearchSource {
  name: string;
  folder: string;
  kind: LibraryKind;
}

/** Half-open `[start, end)` offsets into the original, un-normalized text. */
export type TextRange = readonly [number, number];

export interface LibraryMatch<T> {
  item: T;
  nameRanges: TextRange[];
  folderRanges: TextRange[];
}

export interface LibrarySearchResult<T> {
  matches: Array<LibraryMatch<T>>;
  total: number;
}

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
}

interface IndexedField {
  source: string;
  text: string;
  map: number[];
}

interface LibrarySearchEntry {
  name: IndexedField;
  folder: IndexedField;
  keywords: string[];
}

// German first (the product voice), plus the English words people type anyway.
const KIND_KEYWORDS: Record<LibraryKind, readonly string[]> = {
  image: ['bild', 'bilder', 'foto', 'grafik', 'screenshot', 'image'],
  video: ['video', 'film'],
  audio: ['audio', 'musik', 'ton', 'sprachnachricht'],
  pdf: ['pdf'],
  doc: ['dokument', 'text', 'word', 'brief'],
  sheet: ['tabelle', 'tabellen', 'excel', 'kalkulation', 'sheet', 'csv'],
  slides: ['präsentation', 'folien', 'powerpoint', 'slides'],
  code: ['code', 'skript', 'script', 'quelltext'],
  archive: ['archiv', 'zip', 'komprimiert'],
  md: ['notiz', 'notizen', 'markdown'],
  generic: ['datei'],
  document: ['dokument', 'dokumente', 'entwurf', 'live'],
};

const COMBINING_MARK = /^[̀-ͯ]$/;

function kindLabel(kind: LibraryKind): string {
  return kind === 'document' ? 'Dokument' : attachmentKindLabel(kind);
}

function indexField(source: string): IndexedField {
  const { text, map } = normalizeWithMap(source);
  return { source, text, map };
}

function buildEntry(source: LibrarySearchSource): LibrarySearchEntry {
  const keywords = new Set([...KIND_KEYWORDS[source.kind], kindLabel(source.kind)].map(normalizeForSearch));
  return {
    name: indexField(source.name),
    folder: indexField(source.folder),
    keywords: [...keywords],
  };
}

/** Normalized, non-empty query words. */
export function parseLibraryQuery(query: string): string[] {
  return normalizeForSearch(query).split(/\s+/).filter(Boolean);
}

/** End offset in the original text, extended over trailing combining marks. */
function originalEnd(source: string, lastIndex: number): number {
  let end = lastIndex + ([...source.slice(lastIndex)][0]?.length ?? 1);
  while (end < source.length && COMBINING_MARK.test(source[end])) end += 1;
  return end;
}

function findRanges(field: IndexedField, term: string): TextRange[] {
  const ranges: TextRange[] = [];
  let at = field.text.indexOf(term);
  while (at >= 0) {
    const start = field.map[at];
    ranges.push([start, originalEnd(field.source, field.map[at + term.length - 1])]);
    at = field.text.indexOf(term, at + term.length);
  }
  return ranges;
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]];
  for (const [start, end] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

function matchEntry<T>(item: T, entry: LibrarySearchEntry, terms: readonly string[]): LibraryMatch<T> | null {
  const nameRanges: TextRange[] = [];
  const folderRanges: TextRange[] = [];
  for (const term of terms) {
    const inName = findRanges(entry.name, term);
    const inFolder = findRanges(entry.folder, term);
    const isKind = entry.keywords.some((keyword) => keyword.startsWith(term));
    if (inName.length === 0 && inFolder.length === 0 && !isKind) return null;
    nameRanges.push(...inName);
    folderRanges.push(...inFolder);
  }
  return { item, nameRanges: mergeRanges(nameRanges), folderRanges: mergeRanges(folderRanges) };
}

/**
 * Search index keyed by item identity. Library items are replaced (never
 * mutated) when they change, so a new object is a new entry and stale entries
 * are collected with the item they described.
 */
export class LibrarySearchIndex<T extends object> {
  private readonly entries = new WeakMap<T, LibrarySearchEntry>();

  constructor(private readonly describe: (item: T) => LibrarySearchSource) {}

  search(items: readonly T[], query: string): LibrarySearchResult<T> {
    const terms = parseLibraryQuery(query);
    if (terms.length === 0) {
      return {
        matches: items.map((item) => ({ item, nameRanges: [], folderRanges: [] })),
        total: items.length,
      };
    }
    const matches: Array<LibraryMatch<T>> = [];
    for (const item of items) {
      const match = matchEntry(item, this.entryFor(item), terms);
      if (match) matches.push(match);
    }
    return { matches, total: items.length };
  }

  private entryFor(item: T): LibrarySearchEntry {
    const cached = this.entries.get(item);
    if (cached) return cached;
    const entry = buildEntry(this.describe(item));
    this.entries.set(item, entry);
    return entry;
  }
}

/** Splits text into plain and highlighted runs for `<mark>` rendering. */
export function splitHighlight(text: string, ranges: readonly TextRange[]): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false });
    segments.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }
  return segments;
}
