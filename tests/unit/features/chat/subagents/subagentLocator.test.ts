import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import type { ChatMessage, Conversation } from '@/core/types';
import { SubagentManager } from '@/features/chat/services/SubagentManager';
import {
  findSubagentInMessages,
  type LocatableTab,
  type LocatableView,
  resolveSubagentSource,
} from '@/features/chat/subagents/subagentLocator';

function viewWith(tabs: LocatableTab[]): LocatableView {
  return { getTabManager: () => ({ getAllTabs: () => tabs }) };
}

function conversation(messages: ChatMessage[]): Conversation {
  return { id: 'conv-1', providerId: 'claude', title: 'CERTUSS', createdAt: 1, updatedAt: 1, sessionId: null, messages };
}

const storedMessage: ChatMessage = {
  id: 'a1',
  role: 'assistant',
  content: '',
  timestamp: 1,
  toolCalls: [{
    id: 'toolu_old',
    name: 'Agent',
    input: {},
    status: 'completed',
    subagent: { id: 'toolu_old', description: 'Alt', status: 'completed', toolCalls: [], isExpanded: false },
  }],
};

describe('subagent locator', () => {
  it('finds a stored subagent on its Agent tool call', () => {
    expect(findSubagentInMessages([storedMessage], 'toolu_old')?.description).toBe('Alt');
    expect(findSubagentInMessages([storedMessage], 'nope')).toBeUndefined();
  });

  it('prefers the chat tab that runs the subagent, and follows it live', async () => {
    const manager = new SubagentManager(() => {});
    manager.handleTaskToolUse('toolu_live', { run_in_background: false, description: 'Läuft' }, createMockEl('div'));
    const locate = jest.fn();
    const tab: LocatableTab = { id: 'tab-1', conversationId: 'conv-1', services: { subagentManager: manager } };

    const source = await resolveSubagentSource({
      getViews: () => [viewWith([tab])],
      getConversation: async () => conversation([]),
      locate,
    }, 'toolu_live', 'conv-1');

    expect(source?.live).toBe(true);
    expect(source?.conversationTitle).toBe('CERTUSS');
    const listener = jest.fn();
    source?.subscribe(listener);
    manager.appendText('toolu_live', 'Neu');
    expect(listener).toHaveBeenCalled();
    source?.locate?.();
    expect(locate).toHaveBeenCalledWith(expect.anything(), tab, 'toolu_live');
  });

  it('falls back to the saved conversation, read-only', async () => {
    const source = await resolveSubagentSource({
      getViews: () => [],
      getConversation: async () => conversation([storedMessage]),
      locate: jest.fn(),
    }, 'toolu_old', 'conv-1');

    expect(source?.live).toBe(false);
    expect(source?.getInfo()?.description).toBe('Alt');
    expect(source?.stopScope()).toBe('none');
  });

  it('gives up when the subagent is nowhere', async () => {
    await expect(resolveSubagentSource({
      getViews: () => [],
      getConversation: async () => null,
      locate: jest.fn(),
    }, 'toolu_x', 'conv-1')).resolves.toBeNull();
  });
});
