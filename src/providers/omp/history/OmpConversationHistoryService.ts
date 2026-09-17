import type {
  ProviderConversationHistoryService,
  ProviderHistoryPathContext,
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
 * the transcript filename ends with the session id, so the session id plus the
 * right agent directory is enough to find it.
 *
 * The directory is NOT `process.env`-derived. `OMP_PROFILE` relocates omp's
 * whole agent dir to `~/.omp/profiles/<name>/agent`, and the user sets it in the
 * provider's environment box — so replay has to resolve against the same
 * environment the runtime hands the child process, which is exactly what
 * `pathContext.environment` carries.
 */
export class OmpConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
    pathContext?: ProviderHistoryPathContext,
  ): Promise<void> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const environment = pathContext?.environment;
    // Keyed on the profile too: the same session id resolves to a different
    // transcript once the profile changes, so a cached hit would be wrong.
    const hydrationKey = `${sessionId}::${environment?.OMP_PROFILE ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = await loadOmpSessionMessages(sessionId, environment);
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

    this.hydratedKeys.set(conversation.id, hydrationKey);
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
