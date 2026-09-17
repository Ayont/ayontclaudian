import type {
  ProviderConversationHistoryService,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import {
  isOmpSessionHydrationDiagnosticMessage,
  loadOmpSessionMessages,
} from './OmpHistoryStore';

/**
 * Oh My Pi owns its transcripts on disk; Claudian only replays them.
 *
 * There is no database-path hint to carry in `providerState` (unlike Opencode):
 * the transcript filename ends with the session id, so the session id alone is
 * enough to find it.
 */
export class OmpConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === sessionId
    ) {
      return;
    }

    const messages = await loadOmpSessionMessages(sessionId);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    if (
      messages.length === 1
      && isOmpSessionHydrationDiagnosticMessage(messages[0])
    ) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    this.hydratedKeys.set(conversation.id, sessionId);
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate OMP native history.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }
}
