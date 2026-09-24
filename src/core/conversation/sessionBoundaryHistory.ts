import type { ChatMessage } from '../types';

/**
 * Keeps the local transcript that precedes a fresh native session.
 *
 * Most providers hydrate by replacing the transcript with their own native
 * session. After "continue with less context" that session starts empty, so a
 * plain replace would drop every earlier turn from the chat on the next load.
 * Messages up to the newest boundary exist only locally and are kept.
 */
export function preserveHistoryBeforeSessionBoundary(
  cached: readonly ChatMessage[],
  hydrated: ChatMessage[],
): ChatMessage[] {
  let boundaryIndex = -1;
  for (let index = cached.length - 1; index >= 0; index -= 1) {
    if (cached[index].sessionBoundary === 'condensed') {
      boundaryIndex = index;
      break;
    }
  }
  if (boundaryIndex < 0) {
    return hydrated;
  }

  const boundaryId = cached[boundaryIndex].id;
  if (hydrated.some((message) => message.id === boundaryId)) {
    return hydrated;
  }
  return [...cached.slice(0, boundaryIndex + 1), ...hydrated];
}

/**
 * The part of the visible history the provider still holds. After a compaction
 * (a `context_compacted` block) or a fresh condensed session, everything before
 * it was replaced by a summary: replaying it would refill the window, and an
 * estimate over the whole transcript would read "full" forever.
 */
export function historyInContext(messages: readonly ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sessionBoundary === 'condensed') {
      return messages.slice(index + 1);
    }
    if (message.contentBlocks?.some((block) => block.type === 'context_compacted')) {
      // The compacting answer is where the provider's summary begins.
      return messages.slice(index);
    }
  }
  return [...messages];
}
