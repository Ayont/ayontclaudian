import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { streamToChatMessages } from '../normalization/streamMapping';
import { buildPersistedVibeState, getVibeState } from '../types';
import { deleteVibeSessionDir, readVibeSessionLog } from './VibeSessionStore';

/**
 * Native-history service for Vibe.
 *
 * Vibe persists each session under `~/.vibe/sessions/<id>/`, so Claudian only
 * stores the session id and rebuilds messages from the session log on demand.
 * Live turn events stream off stdout; this service is only for hydrating an
 * existing conversation's history and deleting its on-disk session. Mirrors
 * `AntigravityConversationHistoryService` (native history, no plugin-side
 * message storage).
 */
export class VibeConversationHistoryService implements ProviderConversationHistoryService {
  private readonly hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const state = getVibeState(conversation.providerState);
    const sessionId = state.sessionId ?? conversation.sessionId ?? null;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const buffer = readVibeSessionLog(sessionId);
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
    const sessionId = getVibeState(conversation.providerState).sessionId ?? conversation.sessionId;
    if (sessionId) {
      deleteVibeSessionDir(sessionId);
    }
    this.hydratedKeys.delete(conversation.id);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = getVibeState(conversation?.providerState);
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
    // Vibe has no fork support (capabilities.supportsFork === false).
    return {};
  }

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return buildPersistedVibeState(getVibeState(conversation.providerState));
  }
}
