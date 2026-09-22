import { extractUserDisplayContent } from '../../utils/context';
import type { ChatMessage } from '../types';

/**
 * What the history needs to find and describe a chat without loading it.
 *
 * Built whenever a chat's messages are in memory and stored with its metadata,
 * because most chats are listed without ever being loaded: before this, every
 * row read "New conversation" and search only saw titles.
 */
export interface ConversationSearchIndex {
  /** First prompt, as the user wrote it. */
  preview: string;
  /** Latest prompt, when it differs from the first: where the chat stopped. */
  lastPrompt?: string;
  /** Prompts plus the opening of each reply, whitespace-collapsed and bounded. */
  text: string;
}

const PREVIEW_LIMIT = 160;
const REPLY_OPENING_LIMIT = 240;
export const SEARCH_INDEX_TEXT_LIMIT = 2_400;

function collapse(text: string): string {
  return text.replace(/```[\w-]*/g, ' ').replace(/\s+/g, ' ').trim();
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function userText(message: ChatMessage): string {
  // Stored prompts carry vault, graph, memory and image envelopes around what
  // the user typed; the display text is what the history should show.
  const shown = message.displayContent ?? extractUserDisplayContent(message.content) ?? message.content;
  return collapse(shown ?? '');
}

export function buildConversationSearchIndex(messages: readonly ChatMessage[]): ConversationSearchIndex | undefined {
  const prompts: string[] = [];
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const text = userText(message);
      if (!text) continue;
      prompts.push(text);
      parts.push(text);
    } else if (message.role === 'assistant') {
      const text = collapse(message.content ?? '');
      if (text) parts.push(clip(text, REPLY_OPENING_LIMIT));
    }
  }
  if (prompts.length === 0) return undefined;

  const preview = clip(prompts[0], PREVIEW_LIMIT);
  const last = clip(prompts[prompts.length - 1], PREVIEW_LIMIT);
  return {
    preview,
    ...(prompts.length > 1 && last !== preview ? { lastPrompt: last } : {}),
    text: parts.join(' · ').slice(0, SEARCH_INDEX_TEXT_LIMIT),
  };
}
