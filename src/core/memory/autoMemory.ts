import type { Vault } from 'obsidian';

import { storeMemory } from './memoryService';

/**
 * Auto-Memory: the model marks durable facts itself by emitting a
 * ```claudian-memory fenced block (same pattern language as `network-map` and
 * `claudian-document`). The plugin persists the block into the chat memory
 * store at stream end and renders it as a subtle chip instead of raw code.
 *
 * Block format:
 * ```claudian-memory
 * topic: Kurzer Titel
 * tags: tag1, tag2
 * ---
 * 1–3 Sätze Inhalt.
 * ```
 */

export interface AutoMemoryBlock {
  topic: string;
  tags: string[];
  content: string;
  /** False while the fence is still streaming (no closing ```). */
  closed: boolean;
}

const FENCE_OPEN_RE = /^```claudian-memory\s*$/;
const FENCE_CLOSE_RE = /^```\s*$/;

/** Parses every claudian-memory fence in document order. */
export function parseAutoMemoryBlocks(markdown: string): AutoMemoryBlock[] {
  const lines = markdown.split('\n');
  const blocks: AutoMemoryBlock[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN_RE.test(lines[i])) continue;

    const bodyLines: string[] = [];
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (FENCE_CLOSE_RE.test(lines[j])) {
        closed = true;
        break;
      }
      bodyLines.push(lines[j]);
    }
    i = j;

    blocks.push(parseBlockBody(bodyLines, closed));
  }

  return blocks;
}

function parseBlockBody(bodyLines: string[], closed: boolean): AutoMemoryBlock {
  let topic = '';
  let tags: string[] = [];
  let contentStart = 0;
  let sawSeparator = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i].trim();
    if (line === '---') {
      sawSeparator = true;
      contentStart = i + 1;
      break;
    }
    const topicMatch = line.match(/^topic:\s*(.+)$/i);
    if (topicMatch) {
      topic = topicMatch[1].trim();
      continue;
    }
    const tagsMatch = line.match(/^tags:\s*(.+)$/i);
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      continue;
    }
    // First non-header line without a separator: treat the rest as content.
    if (line !== '') {
      contentStart = i;
      break;
    }
    contentStart = i + 1;
  }

  const content = bodyLines
    .slice(sawSeparator ? contentStart : contentStart)
    .join('\n')
    .trim();

  return { topic, tags, content, closed };
}

/**
 * Persists all complete blocks into the chat memory store. Idempotent per
 * topic: `storeMemory` writes to a deterministic slug and overwrites, so a
 * repeated call for the same answer never duplicates entries. Returns the
 * stored file paths.
 */
export async function persistAutoMemories(
  vault: Vault,
  folder: string,
  markdown: string,
): Promise<string[]> {
  if (!markdown.includes('```claudian-memory')) return [];

  const stored: string[] = [];
  for (const block of parseAutoMemoryBlocks(markdown)) {
    if (!block.closed || !block.topic || !block.content) continue;
    try {
      stored.push(await storeMemory(vault, folder, block.topic, block.content, block.tags));
    } catch {
      // One malformed block must not break the remaining ones.
    }
  }
  return stored;
}
