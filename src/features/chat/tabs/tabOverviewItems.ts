import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../../main';
import { isLiveSubagentPhase, resolveSubagentPhase } from '../subagents/subagentPresentation';
import { composerDraftKeyForTab } from './composerDraftTab';
import { getTabProviderId } from './providerResolution';
import { getTabTitle } from './Tab';
import { displayTabTitle, type TabOverviewItem } from './tabOverviewModel';
import type { TabData } from './types';

export interface TabOverviewPlacement {
  index: number;
  isActive: boolean;
  canClose: boolean;
}

function readModelLabel(tab: TabData): string | null {
  try {
    return tab.ui.modelSelector?.getCurrentModelLabel() ?? null;
  } catch {
    // A provider whose catalog is not ready yet still gets a row, without model.
    return null;
  }
}

function countRunningSubagents(tab: TabData): number {
  const manager = tab.services?.subagentManager;
  if (!manager?.getAllSubagents) return 0;
  return manager.getAllSubagents().filter((info) => isLiveSubagentPhase(resolveSubagentPhase(info))).length;
}

/**
 * One overview row from in-memory state only. Hidden tabs must never be
 * hydrated for this: `getConversationSync` reads metadata, never transcripts.
 */
export function buildTabOverviewItem(
  tab: TabData,
  placement: TabOverviewPlacement,
  plugin: ClaudianPlugin,
): TabOverviewItem {
  const { state } = tab;
  const providerId = getTabProviderId(tab, plugin);
  const conversation = tab.conversationId ? plugin.getConversationSync(tab.conversationId) : null;
  const todos = state.currentTodos;
  const usagePercent = state.usage?.percentage ?? conversation?.usage?.percentage;

  return {
    id: tab.id,
    index: placement.index,
    title: displayTabTitle(getTabTitle(tab, plugin)),
    providerId,
    providerName: ProviderRegistry.getProviderRegistrationSafe(providerId)?.displayName ?? providerId,
    modelLabel: readModelLabel(tab),
    isActive: placement.isActive,
    isStreaming: state.isStreaming,
    streamingSince: state.isStreaming ? state.responseStartTime ?? null : null,
    attention: state.needsAttention ? state.attentionReason ?? 'input' : null,
    hasDraft: plugin.composerDrafts?.has(composerDraftKeyForTab(tab)) ?? false,
    lastActivityAt: conversation?.lastResponseAt ?? conversation?.updatedAt ?? null,
    contextPercent: typeof usagePercent === 'number' && Number.isFinite(usagePercent) ? usagePercent : null,
    todos: todos && todos.length > 0
      ? { done: todos.filter((todo) => todo.status === 'completed').length, total: todos.length }
      : null,
    runningSubagents: countRunningSubagents(tab),
    canClose: placement.canClose,
    // Messages are not read here: the getter copies the whole transcript.
    isEmpty: !tab.conversationId && !state.isStreaming,
  };
}
