import { extractUserDisplayContent, extractUserQuery } from '../../utils/context';
import { buildBoundedContextFromHistory } from '../../utils/session';
import type { ChatMessage } from '../types';

export interface PrintRetryHistoryParams {
  /** Fully prepared transport prompt, including current output/goal contracts. */
  prompt: string;
  /** Original current request used only to identify a duplicated visible user turn. */
  actualPrompt: string;
  conversationHistory?: ChatMessage[];
}

/**
 * Rebuilds context after a print provider's native session has gone stale.
 *
 * The transcript is sanitized and bounded by the shared history formatter. If
 * the chat state already contains the current user bubble, that bubble is
 * removed from the replay so the full transport prompt can be appended exactly
 * once with its output and standing-goal contracts intact.
 */
export function buildPrintRetryPromptWithHistory(params: PrintRetryHistoryParams): string {
  const history = removeDuplicatedCurrentUserTurn(
    params.conversationHistory ?? [],
    params.actualPrompt,
  );
  const context = buildBoundedContextFromHistory(history);
  return context ? `${context}\n\nUser: ${params.prompt}` : params.prompt;
}

function removeDuplicatedCurrentUserTurn(
  messages: ChatMessage[],
  actualPrompt: string,
): ChatMessage[] {
  const currentQuery = extractUserQuery(actualPrompt).trim();
  if (!currentQuery) {
    return messages;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }

    const visibleQuery = getVisibleUserQuery(message);
    if (visibleQuery !== currentQuery || hasCompletedAssistantReply(messages, index + 1)) {
      return messages;
    }

    return messages.filter((_, messageIndex) => messageIndex !== index);
  }

  return messages;
}

function getVisibleUserQuery(message: ChatMessage): string {
  const displayContent = message.displayContent?.trim();
  if (displayContent) {
    return displayContent;
  }
  return extractUserDisplayContent(message.content ?? '')?.trim()
    || extractUserQuery(message.content ?? '').trim();
}

function hasCompletedAssistantReply(messages: ChatMessage[], startIndex: number): boolean {
  return messages.slice(startIndex).some((message) => {
    if (message.role !== 'assistant' || message.isInterrupt) {
      return false;
    }
    return Boolean(
      message.content?.trim()
      || message.toolCalls?.length
      || message.contentBlocks?.some((block) => block.type === 'thinking'),
    );
  });
}
