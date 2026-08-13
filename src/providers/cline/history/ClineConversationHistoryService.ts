import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { buildPersistedClineState, getClineState } from '../types';
import { deleteClineSessionDir, readClineSessionMessages } from './ClineSessionStore';

/** Keep the richer mid-chat transcript instead of clobbering it with an older Cline session. */
export function shouldReplaceClineHydratedMessages(
  existingCount: number,
  incomingCount: number,
): boolean {
  return incomingCount > 0 && incomingCount >= existingCount;
}

export class ClineConversationHistoryService implements ProviderConversationHistoryService {
  private readonly hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const state = getClineState(conversation.providerState);
    const sessionId = state.sessionId ?? conversation.sessionId ?? null;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const messages = readClineSessionMessages(sessionId);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    if (!shouldReplaceClineHydratedMessages(conversation.messages.length, messages.length)) {
      return;
    }

    const hydrationKey = `${sessionId}::${messages.length}`;
    if (this.hydratedKeys.get(conversation.id) === hydrationKey) {
      return;
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const sessionId = getClineState(conversation.providerState).sessionId ?? conversation.sessionId;
    if (sessionId) {
      deleteClineSessionDir(sessionId);
    }
    this.hydratedKeys.delete(conversation.id);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = getClineState(conversation?.providerState);
    return state.sessionId ?? conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return buildPersistedClineState({}) ?? {};
  }
}
