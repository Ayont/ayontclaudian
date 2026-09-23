import { createMockEl } from '@test/helpers/mockElement';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { TabBar, type TabBarCallbacks } from '@/features/chat/tabs/TabBar';
import type { TabBarItem } from '@/features/chat/tabs/types';

// Helper to create mock callbacks
function createMockCallbacks(): TabBarCallbacks {
  return {
    onTabClick: jest.fn(),
    onTabClose: jest.fn(),
    onNewTab: jest.fn(),
  };
}

// Helper to create tab bar items
function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab',
    providerId: 'claude',
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    attentionReason: null,
    canClose: true,
    hasDraft: false,
    ...overrides,
  };
}

describe('TabBar', () => {
  describe('constructor', () => {
    it('should add tab badges class to container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();

      new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('claudian-tab-badges')).toBe(true);
      expect(containerEl.getAttribute('aria-label')).toBe('Chat-Tabs');
    });
  });

  describe('update', () => {
    it('should clear existing badges before rendering', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      // First update
      tabBar.update([createTabBarItem()]);
      expect(containerEl._children.length).toBe(1);

      // Second update should clear first
      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);
    });

    it('should render badge for each tab item', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', index: 1 }),
        createTabBarItem({ id: 'tab-2', index: 2 }),
        createTabBarItem({ id: 'tab-3', index: 3 }),
      ]);

      expect(containerEl._children.length).toBe(3);
    });

    it('should render empty when no items', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([]);

      expect(containerEl._children.length).toBe(0);
    });
  });

  describe('badge rendering', () => {
    it('uses native buttons and exposes the active tab', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ isActive: true })]);

      const badge = containerEl._children[0];
      expect(badge.tagName).toBe('BUTTON');
      expect(badge.getAttribute('type')).toBe('button');
      expect(badge.getAttribute('aria-current')).toBe('page');
    });

    it('should display index number as text', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ index: 5 })]);

      expect(containerEl._children[0].textContent).toBe('5');
    });

    it('should set aria-label tooltip from item title', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ title: 'My Conversation' })]);

      expect(containerEl._children[0].getAttribute('aria-label')).toBe('My Conversation');
      // title attribute is intentionally omitted to prevent double tooltip
      expect(containerEl._children[0].getAttribute('title')).toBeNull();
    });

    it('should set a provider attribute for per-tab streaming colors', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ providerId: 'opencode' })]);

      expect(containerEl._children[0].getAttribute('data-provider')).toBe('opencode');
    });

    it('renders custom topic titles and suppresses generic New Chat titles', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([
        createTabBarItem({ id: 'tab-1', title: 'Fortinet Firewall' }),
        createTabBarItem({ id: 'tab-2', title: 'New Chat' }),
        createTabBarItem({ id: 'tab-3', title: 'Neuer Chat' }),
      ]);

      const badge1 = containerEl._children[0];
      const badge2 = containerEl._children[1];
      const badge3 = containerEl._children[2];

      expect(badge1.getAttribute('data-tab-title')).toBe('Fortinet Firewall');
      expect(badge2.getAttribute('data-tab-title')).toBeNull();
      expect(badge3.getAttribute('data-tab-title')).toBeNull();
    });

    it('renders streaming indicator when tab is actively streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'stream-tab', isStreaming: true, title: 'Analysis' })]);

      const badge = containerEl._children[0];
      expect(badge._children.some((c: any) => c._classList?.has('claudian-tab-streaming-indicator'))).toBe(true);
      expect(badge.getAttribute('aria-label')).toBe('Analysis · Arbeitet');
    });

    it('marks a tab whose chat holds an unsent draft with a pencil', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ id: 'draft-tab', hasDraft: true, title: 'Angebot CERTUSS' })]);

      const badge = containerEl._children[0];
      expect(badge._children.some((c: any) => c._classList?.has('claudian-tab-draft-indicator'))).toBe(true);
      expect(badge._classList.has('claudian-tab-badge--draft')).toBe(true);
      expect(badge.getAttribute('aria-label')).toBe('Angebot CERTUSS · Entwurf');
    });

    it('shows no pencil when the chat has no draft', () => {
      const containerEl = createMockEl();
      const tabBar = new TabBar(containerEl, createMockCallbacks());

      tabBar.update([createTabBarItem({ id: 'plain-tab', title: 'Leer' })]);

      const badge = containerEl._children[0];
      expect(badge._children.some((c: any) => c._classList?.has('claudian-tab-draft-indicator'))).toBe(false);
      expect(badge.getAttribute('aria-label')).toBe('Leer');
    });
  });

  describe('badge state classes', () => {
    it('should apply idle class for inactive tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: false, isStreaming: false, needsAttention: false })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-idle')).toBe(true);
    });

    it('should apply active class for active tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-active')).toBe(true);
    });

    it('should apply streaming class for streaming tab', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-streaming')).toBe(true);
    });

    it('should apply attention class for tab needing attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-attention')).toBe(true);
    });

    it('should prioritize active over attention', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-tab-badge-attention')).toBe(false);
    });

    it('should prioritize attention over streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isStreaming: true, needsAttention: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-attention')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-tab-badge-streaming')).toBe(false);
    });

    it('should prioritize active over streaming', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ isActive: true, isStreaming: true })]);

      expect(containerEl._children[0]._classList.has('claudian-tab-badge-active')).toBe(true);
      expect(containerEl._children[0]._classList.has('claudian-tab-badge-streaming')).toBe(false);
    });
  });

  describe('badge interactions', () => {
    it('should call onTabClick when badge is clicked', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'clicked-tab' })]);

      // Simulate click
      containerEl._children[0].dispatchEvent('click');

      expect(callbacks.onTabClick).toHaveBeenCalledWith('clicked-tab');
    });

    it('should call onTabClose on right-click when canClose is true', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);

      // Simulate right-click (contextmenu)
      const mockEvent = { preventDefault: jest.fn() };
      containerEl._children[0].dispatchEvent('contextmenu', mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabClose).toHaveBeenCalledWith('closeable-tab');
    });

    // A right-click used to close the tab at once, even mid-answer.
    it('opens the tab menu on right-click instead of closing when a menu handler exists', () => {
      const containerEl = createMockEl();
      const callbacks = { ...createMockCallbacks(), onTabContextMenu: jest.fn() };
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);
      const mockEvent = { preventDefault: jest.fn() };
      containerEl._children[0].dispatchEvent('contextmenu', mockEvent);

      expect(callbacks.onTabContextMenu).toHaveBeenCalledWith('closeable-tab', mockEvent);
      expect(callbacks.onTabClose).not.toHaveBeenCalled();
    });

    it('lets keyboard users close a closeable tab with Delete', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'closeable-tab', canClose: true })]);
      const preventDefault = jest.fn();
      containerEl._children[0].dispatchEvent({ type: 'keydown', key: 'Delete', preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(callbacks.onTabClose).toHaveBeenCalledWith('closeable-tab');
    });

    it('should not register contextmenu handler when canClose is false', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem({ id: 'uncloseable-tab', canClose: false })]);

      // Check that contextmenu handler was not registered
      expect(containerEl._children[0]._eventListeners.has('contextmenu')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should empty container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      tabBar.update([createTabBarItem(), createTabBarItem({ id: 'tab-2', index: 2 })]);
      expect(containerEl._children.length).toBe(2);

      tabBar.destroy();

      expect(containerEl._children.length).toBe(0);
    });

    it('should remove tab badges class from container', () => {
      const containerEl = createMockEl();
      const callbacks = createMockCallbacks();
      const tabBar = new TabBar(containerEl, callbacks);

      expect(containerEl._classList.has('claudian-tab-badges')).toBe(true);

      tabBar.destroy();

      expect(containerEl._classList.has('claudian-tab-badges')).toBe(false);
    });
  });
});

// Every streaming, title, draft or attention change rebuilt all badges.
describe('TabBar incremental updates', () => {
  const item = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, index: Number(id.slice(-1)), title: `Chat ${id}`, providerId: 'claude',
    isActive: false, isStreaming: false, needsAttention: false, canClose: true, hasDraft: false,
    ...overrides,
  });

  it('keeps unchanged badges and redraws only the changed one', () => {
    const containerEl = createMockEl();
    const bar = new TabBar(containerEl as never, { onTabClick: jest.fn(), onTabClose: jest.fn(), onNewTab: jest.fn() });
    bar.update([item('tab-1', { isActive: true }), item('tab-2')] as never);
    const [first, second] = containerEl.children;

    bar.update([item('tab-1', { isActive: true }), item('tab-2', { isStreaming: true })] as never);

    expect(containerEl.children[0]).toBe(first);
    expect(containerEl.children[1]).not.toBe(second);
    expect(containerEl.children).toHaveLength(2);
  });

  it('drops badges of closed tabs', () => {
    const containerEl = createMockEl();
    const bar = new TabBar(containerEl as never, { onTabClick: jest.fn(), onTabClose: jest.fn(), onNewTab: jest.fn() });
    bar.update([item('tab-1'), item('tab-2')] as never);

    bar.update([item('tab-1')] as never);

    expect(containerEl.children).toHaveLength(1);
  });
});

describe('TabBar legibility with many tabs', () => {
  const item = (id: string, overrides: Partial<TabBarItem> = {}): TabBarItem => ({
    id, index: Number(id.slice(-1)), title: `Chat ${id}`, providerId: 'claude',
    isActive: false, isStreaming: false, needsAttention: false, attentionReason: null, canClose: true, hasDraft: false,
    ...overrides,
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function withProviderName(name: string): void {
    jest.spyOn(ProviderRegistry, 'getProviderRegistrationSafe').mockReturnValue({
      displayName: name,
      chatUIConfig: { getProviderIcon: () => null },
    } as never);
  }

  /** Lays the badges out like a 6px-gap strip of 40px badges. */
  function layOut(containerEl: any, clientWidth: number, scrollLeft = 0): void {
    containerEl.children.forEach((badge: any, position: number) => {
      badge.offsetLeft = position * 46;
      badge.offsetWidth = 40;
    });
    containerEl.clientWidth = clientWidth;
    containerEl.scrollWidth = containerEl.children.length * 46 - 6;
    containerEl.scrollLeft = scrollLeft;
  }

  it('names title, provider and state in the tooltip', () => {
    withProviderName('Claude');
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([
      item('tab-1', { title: 'Firewall CERTUSS', isStreaming: true }),
      item('tab-2', { title: 'New Chat' }),
    ]);

    expect(containerEl.children[0].getAttribute('aria-label')).toBe('Firewall CERTUSS · Claude · Arbeitet');
    expect(containerEl.children[1].getAttribute('aria-label')).toBe('Neuer Chat · Claude');
  });

  it('marks a tab that wants the user back with a reason-coloured dot and says why', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([item('tab-1', { title: 'Angebot', needsAttention: true, attentionReason: 'finished' })]);

    const badge = containerEl.children[0];
    const dot = badge.children.find((child: any) => child.hasClass('claudian-tab-attention-dot'));
    expect(badge.hasClass('claudian-tab-badge-attention')).toBe(true);
    expect(dot?.getAttribute('data-reason')).toBe('finished');
    expect(badge.getAttribute('aria-label')).toBe('Angebot · Neue Antwort');
  });

  it('shows the attention dot instead of the live beacon while a turn waits for approval', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());

    tabBar.update([item('tab-1', { isStreaming: true, needsAttention: true, attentionReason: 'input' })]);

    const classes = containerEl.children[0].children.map((child: any) => child.className);
    expect(classes.some((cls: string) => cls.includes('claudian-tab-attention-dot'))).toBe(true);
    expect(classes.some((cls: string) => cls.includes('claudian-tab-streaming-indicator'))).toBe(false);
  });

  it('redraws a badge when only the attention reason changes', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks());
    tabBar.update([item('tab-1', { needsAttention: true, attentionReason: 'finished' })]);
    const before = containerEl.children[0];

    tabBar.update([item('tab-1', { needsAttention: true, attentionReason: 'failed' })]);

    expect(containerEl.children[0]).not.toBe(before);
  });

  it('counts scrolled-out tabs in a "+N" chip that opens the overview', () => {
    const containerEl = createMockEl();
    const overflowHostEl = createMockEl();
    const onOpenOverview = jest.fn();
    const tabBar = new TabBar(containerEl, { ...createMockCallbacks(), onOpenOverview }, { overflowHostEl });
    const chip = overflowHostEl.querySelector('.claudian-tab-overflow-chip');
    expect(chip?.hasClass('claudian-hidden')).toBe(true);

    tabBar.update(['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6'].map((id) => item(id, { isActive: id === 'tab-1' })));
    layOut(containerEl, 150);
    tabBar.refreshOverflow();

    expect(chip?.hasClass('claudian-hidden')).toBe(false);
    expect(chip?.textContent).toBe('+3');
    expect(chip?.getAttribute('aria-label')).toBe('3 weitere Tabs – Übersicht öffnen');
    expect(containerEl.hasClass('has-overflow-end')).toBe(true);
    expect(containerEl.hasClass('has-overflow-start')).toBe(false);

    chip?.click();
    expect(onOpenOverview).toHaveBeenCalledTimes(1);
  });

  it('lets the chip carry the attention of tabs the user cannot see', () => {
    const containerEl = createMockEl();
    const overflowHostEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks(), { overflowHostEl });

    tabBar.update([
      item('tab-1', { isActive: true }), item('tab-2'), item('tab-3'),
      item('tab-4'), item('tab-5', { needsAttention: true, attentionReason: 'input' }),
    ]);
    layOut(containerEl, 150);
    tabBar.refreshOverflow();

    const chip = overflowHostEl.querySelector('.claudian-tab-overflow-chip');
    expect(chip?.hasClass('has-attention')).toBe(true);
    expect(chip?.getAttribute('aria-label')).toBe('2 weitere Tabs, 1 wartet auf dich – Übersicht öffnen');
  });

  it('scrolls a newly active tab into view', () => {
    const containerEl = createMockEl();
    const tabBar = new TabBar(containerEl, createMockCallbacks(), { overflowHostEl: createMockEl() });
    const ids = ['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6'];
    tabBar.update(ids.map((id) => item(id, { isActive: id === 'tab-1' })));
    layOut(containerEl, 150);
    tabBar.refreshOverflow();
    expect(containerEl.scrollLeft).toBe(0);

    tabBar.update(ids.map((id) => item(id, { isActive: id === 'tab-6' })));
    layOut(containerEl, 150);
    tabBar.refreshOverflow();

    // The last badge ends at 270; the strip scrolls to its maximum.
    expect(containerEl.scrollLeft).toBe(270 - 150);
  });
});
