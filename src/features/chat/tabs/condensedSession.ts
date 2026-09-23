/**
 * "Continue with less context": the same conversation continues in a fresh
 * native provider session, seeded once with a condensed carry. The visible
 * transcript stays; only this provider's session state is dropped, so no
 * foreign or stale session id ever reaches a CLI (trap 3).
 */

import type { AuxiliaryUsageRecord } from '../../../core/auxiliary/AuxiliaryUsageAccounting';
import type { AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { summarizeConversationForCarry } from '../../../core/conversation/condensedContextSummary';
import {
  buildCondensedContextCarry,
  computeCondensedSummaryCharBudget,
  condensedCarryOmitsTurns,
} from '../../../core/conversation/ConversationContextBootstrap';
import type { ProviderId } from '../../../core/providers/types';
import type { ChatMessage, Conversation } from '../../../core/types';
import { t } from '../../../i18n/i18n';

export interface CondensedSessionDeps {
  isStreaming(): boolean;
  getConversationId(): string | null;
  getProviderId(): ProviderId;
  getMessages(): ChatMessage[];
  setMessages(messages: ChatMessage[]): void;
  getGoal(): string | null;
  getContextWindow(): number | undefined;
  /** Isolated runner for the optional summary; null keeps the carry deterministic. */
  createSummaryRunner(): { runner: AuxQueryRunner; model?: string } | null;
  recordAuxiliaryUsage(record: AuxiliaryUsageRecord): void;
  /** Disposes the tab runtime; the next send builds a fresh one from the conversation. */
  releaseRuntime(): void;
  persist(updates: Partial<Conversation>): Promise<void>;
  setPendingBootstrap(carry: string | null): void;
  clearUsage(): void;
  renderBoundary(): void;
  notify(message: string): void;
}

export type CondensedSessionResult = 'started' | 'unsaved' | 'busy' | 'aborted' | 'failed';

export async function startCondensedSession(deps: CondensedSessionDeps): Promise<CondensedSessionResult> {
  if (deps.isStreaming()) {
    deps.notify(t('chat.contextPressure.freshSessionBusy'));
    return 'busy';
  }
  const conversationId = deps.getConversationId();
  if (!conversationId) {
    return 'failed';
  }

  const providerId = deps.getProviderId();
  const messages = deps.getMessages();
  const goal = deps.getGoal();
  const contextWindow = deps.getContextWindow();

  const summary = condensedCarryOmitsTurns(messages, contextWindow)
    ? await requestSummary(deps, providerId, messages, goal, contextWindow)
    : null;

  // The summary can take a while; never reset a session the user moved on from.
  const current = deps.getMessages();
  if (
    deps.isStreaming()
    || deps.getConversationId() !== conversationId
    || deps.getProviderId() !== providerId
    || current.length !== messages.length
    || current[current.length - 1]?.id !== messages[messages.length - 1]?.id
  ) {
    deps.notify(t('chat.contextPressure.freshSessionAborted'));
    return 'aborted';
  }

  const carry = buildCondensedContextCarry({ messages, contextWindowTokens: contextWindow, goal, summary }) || null;
  const marked = markSessionBoundary(messages);

  // Before any state is written: a save through the old runtime would put its
  // session id straight back via buildSessionUpdates().
  deps.releaseRuntime();
  deps.setMessages(marked);
  deps.setPendingBootstrap(carry);
  deps.clearUsage();

  let result: CondensedSessionResult = 'started';
  try {
    await deps.persist({
      sessionId: null,
      providerState: undefined,
      resumeAtMessageId: undefined,
      pendingContextBootstrap: carry,
      usage: undefined,
      messages: marked,
    });
  } catch (error) {
    // The reset is already live in memory; only its durability failed.
    deps.notify(t('chat.contextPressure.freshSessionUnsaved', { error: describeError(error) }));
    result = 'unsaved';
  }

  deps.renderBoundary();
  return result;
}

async function requestSummary(
  deps: CondensedSessionDeps,
  providerId: ProviderId,
  messages: ChatMessage[],
  goal: string | null,
  contextWindow: number | undefined,
): Promise<string | null> {
  const aux = deps.createSummaryRunner();
  if (!aux) {
    return null;
  }
  return summarizeConversationForCarry({
    runner: aux.runner,
    messages,
    goal,
    model: aux.model,
    maxChars: computeCondensedSummaryCharBudget(contextWindow),
    onAccounting: (record) => deps.recordAuxiliaryUsage({ ...record, providerId }),
  });
}

function markSessionBoundary(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) {
    return messages;
  }
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, sessionBoundary: 'condensed' }];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
