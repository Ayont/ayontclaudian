import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { getFreebuffState } from '../types';

/**
 * History service for the Freebuff provider.
 *
 * Threads live in the desktop app and the plugin persists messages itself
 * (supportsNativeHistory is false), so hydration is a no-op. Deleting a
 * conversation closes its thread in the app — best-effort courtesy cleanup.
 */
export class FreebuffConversationHistoryService implements ProviderConversationHistoryService {
  private readonly closedThreads = new Set<string>();

  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Plugin-side messages already carry the history.
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const threadId = getFreebuffState(conversation.providerState).threadId;
    if (!threadId || this.closedThreads.has(threadId)) {
      return;
    }
    this.closedThreads.add(threadId);
    // No port discovery here on purpose: deletion must stay fast and must
    // not fail when the desktop app is closed. A stale open thread is
    // harmless; a future delete after app start closes nothing critical.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return getFreebuffState(conversation?.providerState).threadId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Forks start fresh threads; carrying the source threadId would append
    // both conversations to one desktop thread.
    return {};
  }
}