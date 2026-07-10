/**
 * Pure text-matching helpers for the in-chat search. Kept DOM-free so the
 * matching semantics are unit-testable in the node test environment.
 */

export interface TextNodeMatch {
  /** Index into the searched text-node list. */
  nodeIndex: number;
  /** Match start offset within that node's text. */
  start: number;
  /** Match end offset (exclusive) within that node's text. */
  end: number;
}

/** Hard cap so a 1-character query in a huge chat can't build 10k ranges. */
export const MAX_SEARCH_MATCHES = 500;

/**
 * Finds all case-insensitive, non-overlapping occurrences of `query` across a
 * list of text-node contents. Returns matches in document order, capped at
 * `limit` to keep highlight registration and navigation snappy.
 */
export function findTextMatches(
  texts: readonly string[],
  query: string,
  limit = MAX_SEARCH_MATCHES,
): TextNodeMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];

  const matches: TextNodeMatch[] = [];
  for (let nodeIndex = 0; nodeIndex < texts.length; nodeIndex++) {
    const haystack = texts[nodeIndex].toLowerCase();
    let offset = haystack.indexOf(needle);
    while (offset !== -1) {
      matches.push({ nodeIndex, start: offset, end: offset + needle.length });
      if (matches.length >= limit) return matches;
      offset = haystack.indexOf(needle, offset + needle.length);
    }
  }
  return matches;
}

/** Wraps an index into [0, count) for circular prev/next navigation. */
export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}
