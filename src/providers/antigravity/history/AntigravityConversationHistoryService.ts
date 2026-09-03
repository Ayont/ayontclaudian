import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { transcriptToChatMessages } from '../normalization/transcriptMapping';
import {
  buildPersistedAntigravityState,
  getAntigravityState,
} from '../types';
import {
  deleteAntigravityConversationDir,
  readAntigravityTranscript,
} from './AntigravityBrainStore';

/**
 * Native-history service for Antigravity.
 *
 * Antigravity persists each conversation under
 * `~/.gemini/antigravity-cli/brain/<id>/`, so Claudian only stores the
 * conversation id and rebuilds messages from the transcript.jsonl on demand.
 * Mirrors `PiConversationHistoryService` (native history, no plugin-side
 * message storage).
 */
export class AntigravityConversationHistoryService implements ProviderConversationHistoryService {
  private readonly hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const state = getAntigravityState(conversation.providerState);
    const conversationId = state.conversationId ?? conversation.sessionId ?? null;
    if (!conversationId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const buffer = readAntigravityTranscript(conversationId);
    if (buffer === null) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${conversationId}::${buffer.length}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const cachedUserMessages = conversation.messages.filter((m) => m.role === 'user');
    const messages = transcriptToChatMessages(buffer);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    // Preserve authentic human user messages (content, displayContent, images, attachments)
    // loaded from Claudian's metadata file so truncation or transport leakage in CLI transcripts
    // does not overwrite user-authored prompts or drop attached images.
    let userIndex = 0;
    for (const msg of messages) {
      if (msg.role === 'user') {
        const cached = cachedUserMessages[userIndex++];
        if (cached) {
          if (cached.content !== undefined) msg.content = cached.content;
          if (cached.displayContent !== undefined) msg.displayContent = cached.displayContent;
          if (cached.images && cached.images.length > 0) msg.images = cached.images;
          if (cached.attachments && cached.attachments.length > 0) msg.attachments = cached.attachments;
        }
      }
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  async deleteConversationSession(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const conversationId = getAntigravityState(conversation.providerState).conversationId
      ?? conversation.sessionId;
    if (conversationId) {
      deleteAntigravityConversationDir(conversationId);
    }
    this.hydratedKeys.delete(conversation.id);
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    const state = getAntigravityState(conversation?.providerState);
    return state.conversationId ?? conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return buildPersistedAntigravityState(getAntigravityState(sourceProviderState)) as Record<string, unknown>;
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    return buildPersistedAntigravityState(getAntigravityState(conversation.providerState)) as Record<string, unknown> | undefined;
  }
}
