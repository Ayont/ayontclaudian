import '@/providers';

import type { Conversation } from '@/core/types';
import { applyTabGoal, applyTabNativeGoal, updateTabNativeGoal } from '@/features/chat/tabs/Tab';
import type { TabData } from '@/features/chat/tabs/types';

function setup(conversation: Partial<Conversation> = {}) {
  const stored: Conversation = {
    id: 'conv-1',
    providerId: 'codex',
    title: 'Ziel',
    createdAt: 1,
    updatedAt: 1,
    sessionId: 'thread-1',
    messages: [],
    ...conversation,
  };
  const banner = { setGoal: jest.fn(), setNative: jest.fn(), setPaused: jest.fn(), clear: jest.fn() };
  const plugin = {
    settings: {},
    goalLoopPaused: false,
    getConversationSync: jest.fn(() => stored),
    updateConversation: jest.fn(async (_id: string, updates: Partial<Conversation>) => { Object.assign(stored, updates); }),
  };
  const tab = {
    id: 'tab-1',
    providerId: 'codex',
    conversationId: 'conv-1',
    goal: null,
    ui: { goalBanner: banner },
    state: {},
  } as unknown as TabData;
  return { tab, plugin: plugin as never, stored, banner, updateConversation: plugin.updateConversation };
}

describe('tab goal state', () => {
  it('records a provider-owned goal on the conversation and shows it as native', () => {
    const { tab, plugin, updateConversation, banner } = setup();

    applyTabNativeGoal(tab, plugin, 'Alle Tests grün', 'codex');

    expect(updateConversation).toHaveBeenCalledWith('conv-1', {
      goal: 'Alle Tests grün',
      goalProviderId: 'codex',
      nativeGoal: { objective: 'Alle Tests grün', status: 'active', round: 1 },
    });
    expect(banner.setNative).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'active' }),
      expect.objectContaining({ mode: 'rpc' }),
    );
  });

  it('adopts a goal the provider reports on its own', () => {
    const { tab, plugin, stored } = setup();

    updateTabNativeGoal(tab, plugin, { objective: 'Vom Modell angelegt', status: 'active' });

    expect(stored.goal).toBe('Vom Modell angelegt');
    expect(stored.goalProviderId).toBe('codex');
  });

  it('clears the goal when its provider ends it', () => {
    const { tab, plugin, stored, banner } = setup({ goal: 'x', goalProviderId: 'codex' });
    tab.goal = 'x';
    tab.goalProviderId = 'codex';

    updateTabNativeGoal(tab, plugin, null);

    expect(stored.goal).toBeNull();
    expect(stored.goalProviderId).toBeNull();
    expect(banner.clear).toHaveBeenCalled();
  });

  it('keeps a goal another provider owns when this one reports none', () => {
    const { tab, plugin, stored } = setup({ goal: 'x', goalProviderId: 'claude' });
    tab.goal = 'x';
    tab.goalProviderId = 'claude';

    updateTabNativeGoal(tab, plugin, null);

    expect(stored.goal).toBe('x');
  });

  it('hands a goal set through Claudian\'s loop to nobody else', () => {
    const { tab, plugin, stored, banner } = setup({ goal: 'alt', goalProviderId: 'codex' });

    applyTabGoal(tab, plugin, 'Neu über die Schleife');

    expect(stored.goalProviderId).toBeNull();
    expect(stored.nativeGoal).toBeNull();
    expect(banner.setNative).toHaveBeenLastCalledWith(null, null);
    expect(banner.setGoal).toHaveBeenLastCalledWith('Neu über die Schleife', expect.any(String), 'Claudian-Loop');
  });
});

describe('adoptTabGoalIntoConversation', () => {
  it('writes a goal set in a blank tab onto the chat it became', async () => {
    const { adoptTabGoalIntoConversation } = await import('@/features/chat/tabs/Tab');
    const { tab, plugin, stored } = setup({ goal: undefined });
    tab.goal = 'Vor dem ersten Senden gesetzt';

    adoptTabGoalIntoConversation(tab, plugin);

    expect(stored.goal).toBe('Vor dem ersten Senden gesetzt');
  });

  it('never overwrites a goal the chat already has', async () => {
    const { adoptTabGoalIntoConversation } = await import('@/features/chat/tabs/Tab');
    const { tab, plugin, stored, updateConversation } = setup({ goal: 'Gespeichert' });
    tab.goal = 'Anderes';

    adoptTabGoalIntoConversation(tab, plugin);

    expect(updateConversation).not.toHaveBeenCalled();
    expect(stored.goal).toBe('Gespeichert');
  });
});

describe('goals never cross chats in one tab', () => {
  it('a bound tab reads only its own chat, whatever copy the tab still holds', async () => {
    const { readTabGoal } = await import('@/features/chat/tabs/Tab');
    const { tab, plugin } = setup({ goal: undefined });
    tab.goal = 'Ziel eines anderen Chats';
    tab.goalProviderId = 'codex';

    expect(readTabGoal(tab, plugin)).toEqual({ goal: null, goalProviderId: null, nativeGoal: null });
  });

  it('a new chat in the same tab starts without the previous goal', async () => {
    const { readTabGoal, resetTabGoalMirror } = await import('@/features/chat/tabs/Tab');
    const { tab, plugin, banner } = setup({ goal: 'Alt', goalProviderId: 'codex' });
    tab.goal = 'Alt';
    tab.conversationId = null;

    resetTabGoalMirror(tab, plugin);

    expect(readTabGoal(tab, plugin).goal).toBeNull();
    expect(banner.clear).toHaveBeenCalled();
  });

  it('shows a newly set goal at once, before the save lands', () => {
    const { tab, plugin, banner } = setup({ goal: 'Alt' });

    applyTabGoal(tab, plugin, 'Neu');

    expect(banner.setGoal).toHaveBeenLastCalledWith('Neu', expect.any(String), 'Claudian-Loop');
  });
});
