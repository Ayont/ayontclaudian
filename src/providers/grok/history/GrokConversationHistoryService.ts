import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { streamToChatMessages } from '../normalization/streamMapping';
import { buildPersistedGrokState, getGrokState } from '../types';
import { deleteGrokSessionDir, readGrokSessionLog } from './GrokSessionStore';

/**
 * Native-history service for Grok.
 *
 * Grok persists each session under `~/.grok/sessions/<id>/`, so Claudian only
 * stores the session id and rebuilds messages from the session log on demand.
 * Live turn events stream off stdout; this service is only for hydrating an
 * existing conversation's history and deleting its on-disk session. Mirrors
 * `AntigravityConversationHistoryService` (native history, no plugin-side
 * message storage).
 */
export class GrokConversationHistoryService implements ProviderConversationHistoryService {
  private readonly hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const state = getGrokState(conversation.providerState);
    const sessionId = state.sessionId ?? conversation.sessionId ?? null;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const buffer = readGrokSessionLog(sessionId);
    if (buffer === null) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${sessionId}::${buffer.length}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = streamToChatMessages(buffer);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const sessionId = getGrokState(conversation.providerState).sessionId ?? conversation.sessionId;
    if (sessionId) {
      deleteGrokSessionDir(sessionId);
    }
    this.hydratedKeys.delete(conversation.id);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = getGrokState(conversation?.providerState);
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
    // Grok has no fork support (capabilities.supportsFork === false).
    return {};
  }

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return buildPersistedGrokState(getGrokState(conversation.providerState));
  }
}
