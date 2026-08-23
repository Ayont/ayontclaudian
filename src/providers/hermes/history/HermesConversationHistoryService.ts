import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
} from '../../../core/providers/types';
import type { Conversation } from '../../../core/types';
import { buildPersistedHermesState, getHermesState } from '../types';
import { resolveHermesStatePathHint } from './HermesHistoryPathResolver';
import {
  isHermesSessionHydrationDiagnosticMessage,
  loadHermesSessionMessages,
} from './HermesHistoryStore';

export class HermesConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    const state = getHermesState(conversation.providerState);
    const sessionId = state.sessionId ?? conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const statePath = resolveHermesStatePathHint(state.statePath, pathContext);
    if (state.statePath !== (statePath ?? undefined)) {
      conversation.providerState = buildPersistedHermesState({
        sessionId,
        ...(statePath ? { statePath } : {}),
      });
    }

    const hydrationKey = `${sessionId}::${statePath ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = await loadHermesSessionMessages(sessionId, {
      ...(statePath ? { statePath } : {}),
    });
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    if (messages.length === 1 && isHermesSessionHydrationDiagnosticMessage(messages[0])) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate Hermes' shared session store; it is also the CLI's history.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return getHermesState(conversation?.providerState).sessionId
      ?? conversation?.sessionId
      ?? null;
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

  buildPersistedProviderState(conversation: Conversation): Record<string, unknown> | undefined {
    return buildPersistedHermesState(getHermesState(conversation.providerState));
  }
}
