import {
  buildConversationContextBootstrap,
  computeBootstrapCharCap,
} from '../../../core/conversation/ConversationContextBootstrap';
import type { ChatMessage } from '../../../core/types';
import { DEFAULT_CLINE_CONTEXT_WINDOW } from '../types/models';

const CONTEXT_BLOCK = /<conversation_context>[\s\S]*?<\/conversation_context>/;

export function stripClineConversationContext(prompt: string): string {
  return prompt.replace(new RegExp(CONTEXT_BLOCK.source, 'g'), '').trimStart();
}

/**
 * First Cline turn with no native session.
 *
 * A switch already framed the local transcript into the prompt and cleared
 * history so it is not sent twice. That framed carry is kept. A cold start
 * with history and no framed carry rebuilds one block sized to Cline's real
 * window. A shorter block already in the prompt is replaced by that rebuild;
 * a longer one is left in place.
 */
export function buildClineTurnPrompt(params: {
  history?: ChatMessage[];
  prompt: string;
  sessionId: string | null;
  contextWindowTokens?: number;
}): string {
  if (params.sessionId) {
    return params.prompt;
  }

  const windowTokens = params.contextWindowTokens && params.contextWindowTokens > 0
    ? params.contextWindowTokens
    : DEFAULT_CLINE_CONTEXT_WINDOW;
  const rebuilt = buildConversationContextBootstrap(params.history ?? [], {
    maxChars: computeBootstrapCharCap(windowTokens),
  });
  const existing = params.prompt.match(CONTEXT_BLOCK)?.[0] ?? '';
  if (!rebuilt || existing.length > rebuilt.length) {
    return params.prompt;
  }

  const userLine = stripClineConversationContext(params.prompt);
  return userLine ? `${rebuilt}\n\n${userLine}` : rebuilt;
}
