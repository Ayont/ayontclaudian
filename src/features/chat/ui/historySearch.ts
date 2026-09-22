/**
 * History search: pure, so ranking and excerpts are testable without the DOM.
 *
 * Every word of the query must match somewhere (title, tag, provider, prompts,
 * or indexed reply text). Title matches outrank content matches; ties keep the
 * caller's order (pinned first, then most recent).
 */

export type HistoryFilter = 'all' | 'pinned' | 'drafts' | `provider:${string}`;

export interface HistorySearchEntry {
  id: string;
  title: string;
  providerId: string;
  providerLabel: string;
  tag: string | null;
  preview: string;
  lastPrompt?: string;
  text?: string;
  pinned: boolean;
  hasDraft: boolean;
}

/** One highlighted match with its surroundings, in the original spelling. */
export interface HistorySnippet {
  before: string;
  match: string;
  after: string;
}

export interface HistoryHit<T extends HistorySearchEntry = HistorySearchEntry> {
  entry: T;
  score: number;
  /** Set when the match is not visible in the title. */
  snippet: HistorySnippet | null;
}

export interface HistoryFilterCounts {
  all: number;
  pinned: number;
  drafts: number;
  providers: Array<{ providerId: string; label: string; count: number }>;
}

const SNIPPET_CONTEXT = 44;

const COMBINING_MARKS = /[\u0300-\u036f]/g;

function normalizeChar(char: string): string {
  if (char === 'ß' || char === 'ẞ') return 'ss';
  return char.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** Case-, accent- and ß-insensitive form. Same result as normalizing char by char. */
export function normalizeForSearch(value: string): string {
  return value.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().replace(/ß/g, 'ss');
}

/** Normalized text plus, for each normalized character, its original index. */
function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let index = 0;
  for (const char of value) {
    const normalized = normalizeChar(char);
    for (let i = 0; i < normalized.length; i++) map.push(index);
    text += normalized;
    index += char.length;
  }
  return { text, map };
}

function excerpt(source: string, term: string): HistorySnippet | null {
  const { text, map } = normalizeWithMap(source);
  const at = text.indexOf(term);
  if (at < 0) return null;
  const start = map[at];
  const lastIndex = map[at + term.length - 1];
  // Extend to the end of the original character (e.g. `ß` normalizes to two).
  const end = lastIndex + ([...source.slice(lastIndex)][0]?.length ?? 1);
  const beforeStart = Math.max(0, start - SNIPPET_CONTEXT);
  const afterEnd = Math.min(source.length, end + SNIPPET_CONTEXT);
  return {
    before: `${beforeStart > 0 ? '…' : ''}${source.slice(beforeStart, start)}`,
    match: source.slice(start, end),
    after: `${source.slice(end, afterEnd)}${afterEnd < source.length ? '…' : ''}`,
  };
}

function matchesFilter(entry: HistorySearchEntry, filter: HistoryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'pinned') return entry.pinned;
  if (filter === 'drafts') return entry.hasDraft;
  return entry.providerId === filter.slice('provider:'.length);
}

interface Field {
  weight: number;
  value: string;
  normalized: string;
  /** Content fields can supply the excerpt; title-like fields are visible already. */
  excerptable: boolean;
  isTitle: boolean;
}

// Entries are stable while the history is open; normalize their text once, not
// on every keystroke (472 chats × ~2,400 indexed characters).
const fieldCache = new WeakMap<HistorySearchEntry, Field[]>();

function fieldsOf(entry: HistorySearchEntry): Field[] {
  const cached = fieldCache.get(entry);
  if (cached) return cached;
  const fields = buildFields(entry);
  fieldCache.set(entry, fields);
  return fields;
}

function buildFields(entry: HistorySearchEntry): Field[] {
  const field = (weight: number, value: string | null | undefined, excerptable: boolean, isTitle = false): Field | null => (
    value ? { weight, value, normalized: normalizeForSearch(value), excerptable, isTitle } : null
  );
  return [
    field(6, entry.title, false, true),
    field(3, entry.tag, false),
    field(2, entry.providerLabel, false),
    field(2, entry.lastPrompt, true),
    field(2, entry.preview, true),
    field(1, entry.text, true),
  ].filter((value): value is Field => value !== null);
}

export function searchHistory<T extends HistorySearchEntry>(
  entries: readonly T[],
  query: string,
  filter: HistoryFilter,
): Array<HistoryHit<T>> {
  const scoped = entries.filter((entry) => matchesFilter(entry, filter));
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return scoped.map((entry) => ({ entry, score: 0, snippet: null }));
  }

  const hits: Array<HistoryHit<T> & { order: number }> = [];
  scoped.forEach((entry, order) => {
    const fields = fieldsOf(entry);
    const titleField = fields.find((candidate) => candidate.isTitle);
    let score = 0;
    let snippet: HistorySnippet | null = null;
    let allInTitle = true;
    for (const term of terms) {
      const best = fields
        .filter((candidate) => candidate.normalized.includes(term))
        .sort((a, b) => b.weight - a.weight)[0];
      if (!best) return;
      score += best.weight;
      if (best.excerptable) {
        allInTitle = false;
        snippet ??= excerpt(best.value, term);
      } else if (best !== titleField) {
        allInTitle = false;
      }
    }
    const title = titleField?.normalized ?? '';
    if (allInTitle) score += 3;
    if (terms.some((term) => title.startsWith(term))) score += 2;
    hits.push({ entry, score, snippet, order });
  });

  return hits
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ entry, score, snippet }) => ({ entry, score, snippet }));
}

export function countHistoryFilters(entries: readonly HistorySearchEntry[]): HistoryFilterCounts {
  const providers = new Map<string, { providerId: string; label: string; count: number }>();
  let pinned = 0;
  let drafts = 0;
  for (const entry of entries) {
    if (entry.pinned) pinned++;
    if (entry.hasDraft) drafts++;
    const existing = providers.get(entry.providerId);
    if (existing) existing.count++;
    else providers.set(entry.providerId, { providerId: entry.providerId, label: entry.providerLabel, count: 1 });
  }
  return {
    all: entries.length,
    pinned,
    drafts,
    providers: [...providers.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
