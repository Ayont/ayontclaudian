/**
 * Semantic "related notes" discovery — the flagship recall feature users expect
 * from an Obsidian AI plugin (à la Smart Connections). Reuses the existing
 * VaultRAGService embeddings + vector store: embed the active note, search, then
 * collapse the chunk hits into a ranked, deduplicated per-note list.
 *
 * This module is pure (no Obsidian/DOM deps) so the ranking logic is unit
 * tested; the orchestration + UI live in the feature layer.
 */

import type { RAGChunk } from './VaultRAGService';

/** A note semantically related to the active note. */
export interface RelatedNote {
  /** Vault-relative path of the related note. */
  path: string;
  /** Best chunk similarity score for this note (0–1, higher = closer). */
  score: number;
  /** Short preview from the best-matching chunk. */
  snippet: string;
}

/** How many chunk hits to request from the vector store before collapsing. */
export const RELATED_QUERY_LIMIT = 40;
/** How many related notes to show. */
export const RELATED_RESULT_LIMIT = 8;
/** Cap the active note's text fed into the query embedding. */
export const RELATED_QUERY_MAX_CHARS = 4000;

const SNIPPET_MAX_CHARS = 160;

/** Collapse whitespace and clip a chunk into a compact one-line preview. */
export function makeSnippet(text: string, maxChars: number = SNIPPET_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxChars) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxChars).trimEnd()}…`;
}

/**
 * Cap the active note's content for the query embedding. Keeping this bounded
 * avoids embedding a huge note (some providers truncate silently) while still
 * capturing its dominant topics from the top of the note.
 */
export function buildRelatedQueryText(content: string, maxChars: number = RELATED_QUERY_MAX_CHARS): string {
  const trimmed = content.trim();
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

/**
 * Collapse chunk-level hits into a ranked per-note list.
 * - Excludes the active note itself (never recommend the note you're reading).
 * - Keeps the single best (max) score per note, plus that chunk's snippet.
 * - Sorts by score descending and returns at most `limit` notes.
 */
export function rankRelatedNotes(
  chunks: RAGChunk[],
  activePath: string,
  limit: number = RELATED_RESULT_LIMIT,
): RelatedNote[] {
  const bestByPath = new Map<string, RelatedNote>();

  for (const chunk of chunks) {
    const path = chunk.path;
    if (!path || path === 'unknown' || path === activePath) {
      continue;
    }
    const existing = bestByPath.get(path);
    if (!existing || chunk.score > existing.score) {
      bestByPath.set(path, {
        path,
        score: chunk.score,
        snippet: existing && chunk.score <= existing.score
          ? existing.snippet
          : makeSnippet(chunk.text),
      });
    }
  }

  return Array.from(bestByPath.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}
