import type { ChatMessage, Conversation, SubagentInfo } from '../../../core/types';
import type { SubagentManager } from '../services/SubagentManager';
import type { SubagentActionController, SubagentStopScope } from './SubagentActionController';

/**
 * Where the inspector reads one subagent from: the chat tab that runs it
 * (live, stoppable), or the saved conversation (history, read-only).
 */
export interface SubagentSource {
  readonly live: boolean;
  readonly conversationTitle?: string;
  getInfo(): SubagentInfo | undefined;
  subscribe(listener: () => void): () => void;
  stopScope(): SubagentStopScope;
  stop(): Promise<void>;
  /** Brings the chat tab forward and scrolls to the subagent's card. */
  locate?: () => void;
}

/** The parts of a chat tab the locator reads; kept narrow for testing. */
export interface LocatableTab {
  id: string;
  conversationId: string | null;
  services: { subagentManager: SubagentManager; subagentActions?: SubagentActionController | null };
}

export interface LocatableView {
  getTabManager(): { getAllTabs(): LocatableTab[] } | null;
}

export interface SubagentLocatorDeps {
  getViews(): LocatableView[];
  getConversation(id: string): Promise<Conversation | null>;
  locate(view: LocatableView, tab: LocatableTab, subagentId: string): void;
}

/** Finds a subagent in a transcript, including one nested on a Task tool call. */
export function findSubagentInMessages(messages: readonly ChatMessage[], subagentId: string): SubagentInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const call of messages[i].toolCalls ?? []) {
      if (call.subagent?.id === subagentId) return call.subagent;
    }
  }
  return undefined;
}

export function findLiveSubagent(
  views: readonly LocatableView[],
  subagentId: string,
): { view: LocatableView; tab: LocatableTab } | null {
  for (const view of views) {
    for (const tab of view.getTabManager()?.getAllTabs() ?? []) {
      if (tab.services.subagentManager.getSubagentById(subagentId)) return { view, tab };
    }
  }
  return null;
}

export async function resolveSubagentSource(
  deps: SubagentLocatorDeps,
  subagentId: string,
  conversationId?: string | null,
): Promise<SubagentSource | null> {
  const live = findLiveSubagent(deps.getViews(), subagentId);
  if (live) {
    const { view, tab } = live;
    const manager = tab.services.subagentManager;
    const conversation = tab.conversationId ? await deps.getConversation(tab.conversationId) : null;
    return {
      live: true,
      ...(conversation?.title ? { conversationTitle: conversation.title } : {}),
      getInfo: () => manager.getSubagentById(subagentId),
      subscribe: listener => manager.onSwarmChange(listener),
      stopScope: () => tab.services.subagentActions?.resolveStopScope(subagentId) ?? 'none',
      stop: async () => {
        await tab.services.subagentActions?.stop(subagentId);
      },
      locate: () => deps.locate(view, tab, subagentId),
    };
  }

  if (!conversationId) return null;
  const conversation = await deps.getConversation(conversationId);
  const stored = conversation ? findSubagentInMessages(conversation.messages, subagentId) : undefined;
  if (!stored) return null;
  return {
    live: false,
    ...(conversation?.title ? { conversationTitle: conversation.title } : {}),
    getInfo: () => stored,
    subscribe: () => () => {},
    stopScope: () => 'none',
    stop: async () => {},
  };
}
