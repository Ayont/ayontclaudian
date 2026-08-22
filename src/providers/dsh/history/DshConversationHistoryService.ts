import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { deleteDshSessionDir } from '../runtime/DshSessionStore';
import { buildPersistedDshState, getDshState } from '../types';

/**
 * History service for dsh.
 *
 * The plugin itself persists conversation messages (supportsNativeHistory is
 * false — dsh transcripts are zstd-compressed on disk and intentionally not
 * decompressed here), so hydration is a no-op that only tracks state keys.
 * Deletion removes the recorded transcript directory as cleanup.
 */
export class DshConversationHistoryService implements ProviderConversationHistoryService {
  async hydrateConversationHistory(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Plugin-side messages already carry the history; nothing to hydrate.
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const dir = getDshState(conversation.providerState).sessionDir;
    if (dir) {
      deleteDshSessionDir(dir);
    }
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return getDshState(conversation?.providerState).sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    // Fork would replay truncated history client-side; no provider state to seed.
    return {};
  }

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return buildPersistedDshState(getDshState(conversation.providerState));
  }
}
