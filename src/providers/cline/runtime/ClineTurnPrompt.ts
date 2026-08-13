import {
  buildConversationContextBootstrap,
} from '../../../core/conversation/ConversationContextBootstrap';
import type { ChatMessage } from '../../../core/types';

/** Cline's 1M-class windows can carry more prior chat than the global 24k switch cap. */
export const CLINE_CONTEXT_BOOTSTRAP_CHAR_CAP = 48_000;

const CONTEXT_BLOCK = /<conversation_context>[\s\S]*?<\/conversation_context>\s*/g;

export function stripClineConversationContext(prompt: string): string {
  return prompt.replace(CONTEXT_BLOCK, '').trimStart();
}

export function buildClineTurnPrompt(params: {
  history?: ChatMessage[];
  prompt: string;
  sessionId: string | null;
}): string {
  if (params.sessionId) {
    return params.prompt;
  }

  const userLine = stripClineConversationContext(params.prompt);
  const bootstrap = buildConversationContextBootstrap(params.history ?? [], {
    maxChars: CLINE_CONTEXT_BOOTSTRAP_CHAR_CAP,
  });
  if (!bootstrap) {
    return userLine || params.prompt;
  }
  return userLine ? `${bootstrap}\n\n${userLine}` : bootstrap;
}
