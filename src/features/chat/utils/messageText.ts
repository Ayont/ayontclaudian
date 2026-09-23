import type { ChatMessage, ContentBlock } from '../../../core/types';
import {
  extractInjectedContextPrompt,
  extractUserDisplayContent,
  stripInternalImageTags,
  stripInternalPromptEnvelopes,
} from '../../../utils/context';

/**
 * The text a user actually typed, exactly as the transcript shows it.
 *
 * `content` is the provider-bound prompt and carries note, selection, RAG,
 * memory, goal and output-contract envelopes; history loaded from a provider
 * transcript has no `displayContent` at all. Anything that takes a prompt out
 * of the chat (copy, export, resend) has to go through here.
 */
export function userMessageText(message: Pick<ChatMessage, 'content' | 'displayContent'>): string {
  const content = message.content ?? '';
  const displayCandidate = message.displayContent
    ? extractUserDisplayContent(message.displayContent) ?? message.displayContent
    : undefined;
  const raw = displayCandidate
    ?? extractInjectedContextPrompt(content)?.userContent
    ?? extractUserDisplayContent(content)
    ?? content;
  return stripInternalPromptEnvelopes(stripInternalImageTags(raw));
}

/** An answer's visible text: the body, or its text blocks when only those were kept. */
export function assistantMessageText(message: Pick<ChatMessage, 'content' | 'contentBlocks'>): string {
  const content = (message.content ?? '').trim();
  if (content) return content;
  return (message.contentBlocks ?? [])
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n\n');
}
