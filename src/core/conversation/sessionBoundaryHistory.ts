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
