import { createMockEl } from '@test/helpers/mockElement';
import { Menu, Modal, Platform, Scope } from 'obsidian';

import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ClaudianView } from '@/features/chat/ClaudianView';

const MockScope = Scope as typeof Scope & { instances: Scope[] };
const MockMenu = Menu as typeof Menu & {
  instances: Array<{ items: Array<{ clickHandler: (() => void) | null }> }>;
};
const MockModal = Modal as typeof Modal & { instances: Modal[] };

function createViewHarness(options: {
  canCreateTab: boolean;
  tabBarPosition?: 'input' | 'header';
  tabCount?: number;
}): {
  newTabButtonEl: ReturnType<typeof createMockEl>;
  view: any;
} {
  const newTabButtonEl = createMockEl();
  const view = Object.create(ClaudianView.prototype) as any;

  view.plugin = {
    settings: {
      tabBarPosition: options.tabBarPosition ?? 'input',
    },
  };
  view.tabManager = {
    canCreateTab: jest.fn().mockReturnValue(options.canCreateTab),
    getTabCount: jest.fn().mockReturnValue(options.tabCount ?? 1),
  };
  view.tabBarContainerEl = createMockEl();
  view.logoEl = createMockEl();
  view.titleTextEl = createMockEl();
  view.newTabButtonEl = newTabButtonEl;

  return { newTabButtonEl, view };
}

describe('ClaudianView tab controls', () => {
  it('hides the new-tab button when the tab manager is at capacity', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: false });

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(true);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBe('true');
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the new-tab button when another tab can be created', () => {
    const { newTabButtonEl, view } = createViewHarness({ canCreateTab: true });
    newTabButtonEl.addClass('claudian-hidden');
    newTabButtonEl.setAttribute('aria-disabled', 'true');
    newTabButtonEl.setAttribute('aria-hidden', 'true');

    view.refreshTabControls();

    expect(newTabButtonEl.hasClass('claudian-hidden')).toBe(false);
    expect(newTabButtonEl.getAttribute('aria-disabled')).toBeNull();
    expect(newTabButtonEl.getAttribute('aria-hidden')).toBeNull();
  });

  it('builds every header action as a labelled native button', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.containerEl = createMockEl();
    view.containerEl.ownerDocument.createDocumentFragment = () => createMockEl('fragment');
    view.plugin = {
      settings: {},
      getPendingPluginUpdate: jest.fn().mockReturnValue(null),
      installPendingPluginUpdate: jest.fn(),
    };
    view.createNewTab = jest.fn().mockResolvedValue(undefined);
    view.updateHistoryDropdown = jest.fn();
    view.tabManager = { createNewConversation: jest.fn().mockResolvedValue(undefined) };
    view.shortcutOverlay = { toggle: jest.fn() };

    const nav = view.buildNavRowContent();
    const buttons = Array.from(nav.querySelectorAll('.claudian-header-btn')) as HTMLElement[];

    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBeTruthy();
    }
    const historyButton = buttons.find((button) => button.getAttribute('aria-label') === 'Chat-Verlauf');
    expect(historyButton?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ClaudianView workspace model picker', () => {
  beforeEach(() => {
    MockMenu.instances.length = 0;
    MockModal.instances.length = 0;
  });

  it('returns the pending persistence promise to the model picker', async () => {
    let releaseSave!: () => void;
    const saveSettings = jest.fn().mockImplementation(() => new Promise<void>((resolve) => {
      releaseSave = resolve;
    }));
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      app: {},
      settings: {
        workspaceModeModels: { code: 'old-model' },
      },
      saveSettings,
    };
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(null) };
    view.workspaceModeToggle = { render: jest.fn() };
    view.resolveActiveWorkspaceMode = jest.fn().mockReturnValue('work');
    jest.spyOn(ProviderRegistry, 'getAggregatedModelOptions').mockReturnValue([
      { value: 'new-model', label: 'New model' },
    ]);

    view.openModeModelMenu('code', { clientX: 0 } as MouseEvent);
    const menu = MockMenu.instances.at(-1)!;
    menu.items[0].clickHandler?.();
    const modal = MockModal.instances.at(-1) as any;

    const selectionResult = modal.onSelect('new-model');
    releaseSave();
    await Promise.resolve();

    expect(selectionResult).toBeInstanceOf(Promise);
    await selectionResult;
    expect(view.plugin.settings.workspaceModeModels.code).toBe('new-model');
  });

  it('restores the workspace model binding when persistence fails', async () => {
    const saveError = new Error('settings disk unavailable');
    const previousModeModels = { code: 'old-model', work: 'work-model' };
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      app: {},
      settings: { workspaceModeModels: previousModeModels },
      saveSettings: jest.fn().mockRejectedValue(saveError),
    };
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(null) };
    view.workspaceModeToggle = { render: jest.fn() };
    view.resolveActiveWorkspaceMode = jest.fn().mockReturnValue('work');
    jest.spyOn(ProviderRegistry, 'getAggregatedModelOptions').mockReturnValue([
      { value: 'new-model', label: 'New model' },
    ]);

    view.openModeModelMenu('code', { clientX: 0 } as MouseEvent);
    MockMenu.instances.at(-1)!.items[0].clickHandler?.();
    const modal = MockModal.instances.at(-1) as any;

    await expect(modal.onSelect('new-model')).rejects.toBe(saveError);
    expect(view.plugin.settings.workspaceModeModels).toBe(previousModeModels);
    expect(view.workspaceModeToggle.render).not.toHaveBeenCalled();
  });

  it('restores a failed workspace model unpin without an unhandled rejection', async () => {
    const saveError = new Error('settings disk unavailable');
    const previousModeModels = { code: 'old-model' };
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      app: {},
      settings: { workspaceModeModels: previousModeModels },
      saveSettings: jest.fn().mockRejectedValue(saveError),
    };
    view.tabManager = { getActiveTab: jest.fn().mockReturnValue(null) };
    view.workspaceModeToggle = { render: jest.fn() };
    jest.spyOn(ProviderRegistry, 'getAggregatedModelOptions').mockReturnValue([]);

    view.openModeModelMenu('code', { clientX: 0 } as MouseEvent);
    MockMenu.instances.at(-1)!.items[1].clickHandler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.plugin.settings.workspaceModeModels).toBe(previousModeModels);
    expect(view.workspaceModeToggle.render).not.toHaveBeenCalled();
  });

  it('preserves a newer workspace model pin when an older save fails', async () => {
    let rejectFirstSave!: (error: Error) => void;
    let saveCall = 0;
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      settings: { workspaceModeModels: { code: 'old-model' } },
      saveSettings: jest.fn().mockImplementation(() => {
        saveCall += 1;
        if (saveCall === 1) {
          return new Promise<void>((_resolve, reject) => {
            rejectFirstSave = reject;
          });
        }
        return Promise.resolve();
      }),
    };
    view.workspaceModeToggle = { render: jest.fn() };
    view.resolveActiveWorkspaceMode = jest.fn().mockReturnValue('work');

    const firstPin = view.persistWorkspaceModeModelBinding('code', 'first-model');
    const secondPin = view.persistWorkspaceModeModelBinding('code', 'second-model');
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1);
    const firstError = new Error('older settings save failed');
    const firstFailure = firstPin.catch((error: unknown) => error);
    rejectFirstSave(firstError);
    await expect(firstFailure).resolves.toBe(firstError);
    await secondPin;

    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(2);
    expect(view.plugin.settings.workspaceModeModels.code).toBe('second-model');
  });

  it('restores the original workspace model when two queued saves both fail', async () => {
    const rejectSaves: Array<(error: Error) => void> = [];
    const previousModeModels = { code: 'old-model' };
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = {
      settings: { workspaceModeModels: previousModeModels },
      saveSettings: jest.fn().mockImplementation(() => new Promise<void>((_resolve, reject) => {
        rejectSaves.push(reject);
      })),
    };
    view.workspaceModeToggle = { render: jest.fn() };
    view.resolveActiveWorkspaceMode = jest.fn().mockReturnValue('work');

    const firstError = new Error('first settings save failed');
    const secondError = new Error('second settings save failed');
    const firstPin = view.persistWorkspaceModeModelBinding('code', 'first-model');
    const secondPin = view.persistWorkspaceModeModelBinding('code', 'second-model');
    const firstFailure = firstPin.catch((error: unknown) => error);
    const secondFailure = secondPin.catch((error: unknown) => error);

    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(1);
    rejectSaves[0](firstError);
    await expect(firstFailure).resolves.toBe(firstError);
    expect(view.plugin.saveSettings).toHaveBeenCalledTimes(2);
    rejectSaves[1](secondError);
    await expect(secondFailure).resolves.toBe(secondError);

    expect(view.plugin.settings.workspaceModeModels).toBe(previousModeModels);
    expect(view.workspaceModeToggle.render).not.toHaveBeenCalled();
  });
});

describe('ClaudianView Escape handling', () => {
  beforeEach(() => {
    MockScope.instances.length = 0;
  });

  function createEscapeHarness(options: {
    isStreaming: boolean;
  }): {
    cancelStreaming: jest.Mock;
    eventRefs: unknown[];
    view: any;
  } {
    const cancelStreaming = jest.fn();
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: options.isStreaming },
        controllers: {
          inputController: { cancelStreaming },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { cancelStreaming, eventRefs, view };
  }

  function createScopedSendHarness(options: {
    inputFocused: boolean;
  }): {
    inputEl: HTMLTextAreaElement;
    sendMessage: jest.Mock;
    view: any;
  } {
    const sendMessage = jest.fn();
    const inputEl = createMockEl('textarea') as unknown as HTMLTextAreaElement;
    Object.defineProperty(inputEl.ownerDocument, 'activeElement', {
      configurable: true,
      get: () => options.inputFocused ? inputEl : null,
    });
    const eventRefs: unknown[] = [];
    const parentScope = new Scope();
    const view = Object.create(ClaudianView.prototype) as any;

    view.app = { scope: parentScope };
    view.containerEl = createMockEl();
    view.historyDropdown = createMockEl();
    view.registerDomEvent = jest.fn();
    view.registerEvent = jest.fn();
    view.eventRefs = eventRefs;
    view.plugin = {
      app: {
        vault: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
        workspace: {
          on: jest.fn((_event: string, handler: unknown) => {
            const ref = { handler };
            eventRefs.push(ref);
            return ref;
          }),
        },
      },
    };
    view.tabManager = {
      getActiveTab: jest.fn().mockReturnValue({
        state: { isStreaming: false },
        dom: { inputEl },
        controllers: {
          inputController: { sendMessage },
        },
        ui: {
          fileContextManager: {
            markFileCacheDirty: jest.fn(),
            markFolderCacheDirty: jest.fn(),
            handleFileOpen: jest.fn(),
            handleClickOutside: jest.fn(),
          },
        },
      }),
    };

    return { inputEl, sendMessage, view };
  }

  it('registers Escape on the Obsidian view scope instead of document keydown capture', () => {
    const { view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();

    expect(view.scope).toBeInstanceOf(Scope);
    expect(view.scope.parent).toBe(view.app.scope);
    expect(view.scope.register).toHaveBeenCalledWith([], 'Escape', expect.any(Function));
    expect(view.registerDomEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      'keydown',
      expect.any(Function),
      { capture: true }
    );
  });

  it('cancels streaming and consumes scoped Escape', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('closes the open history popup before cancelling a stream', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });
    view.historyDropdown.addClass('visible');
    view.historyButtonEl = createMockEl('button');
    view.historyButtonEl.focus = jest.fn();

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(view.historyDropdown.hasClass('visible')).toBe(false);
    expect(view.historyButtonEl.getAttribute('aria-expanded')).toBe('false');
    expect(view.historyButtonEl.focus).toHaveBeenCalledTimes(1);
    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes scoped Escape without cancelling when not streaming', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: false });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({ key: 'Escape', isComposing: false } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('consumes already handled scoped Escape without cancelling again', () => {
    const { cancelStreaming, view } = createEscapeHarness({ isStreaming: true });

    view.wireEventHandlers();
    const escapeHandler = view.scope.handlers.find((handler: any) => handler.key === 'Escape');
    const result = escapeHandler.func({
      key: 'Escape',
      isComposing: false,
      defaultPrevented: true,
    } as KeyboardEvent);

    expect(cancelStreaming).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('sends from focused composer through scoped Mod+Enter', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: true });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it('ignores scoped Mod+Enter when composer is not focused', () => {
    Platform.isMacOS = true;
    const { sendMessage, view } = createScopedSendHarness({ inputFocused: false });

    view.wireEventHandlers();
    const sendHandler = view.scope.handlers.find(
      (handler: any) => handler.key === 'Enter' && handler.modifiers?.includes('Mod')
    );
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: jest.fn(),
    } as unknown as KeyboardEvent;
    const result = sendHandler.func(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});

/**
 * Obsidian reveals a leaf only after the view's `onOpen()` resolves, and
 * `setViewState()` is what the ribbon click awaits. Restoring the previously
 * open conversation therefore must NOT be part of that promise: on a large
 * archive it takes long enough that the pane never appears and the click reads
 * as a dead button.
 */
describe('ClaudianView tab restore', () => {
  function createRestoreHarness(restore: () => Promise<void>) {
    const view = Object.create(ClaudianView.prototype) as any;
    view.plugin = { app: { workspace: { layoutReady: true } } };
    view.restoreOrCreateTabs = jest.fn().mockImplementation(restore);
    view.syncProviderBrandColor = jest.fn();
    view.applyChatAppearance = jest.fn();
    view.updateLayoutForPosition = jest.fn();
    view.applyWorkspaceMode = jest.fn();
    view.tabManager = { primeProviderRuntime: jest.fn() };
    return view;
  }

  it('returns before a slow restore has finished', () => {
    let release: (() => void) | null = null;
    const view = createRestoreHarness(() => new Promise<void>((resolve) => {
      release = resolve;
    }));

    view.startTabRestore();

    expect(view.restoreOrCreateTabs).toHaveBeenCalledTimes(1);
    // Still pending — the call above returned anyway.
    expect(view.applyChatAppearance).not.toHaveBeenCalled();
    expect(release).not.toBeNull();
  });

  it('still finishes view setup when restoring the stored conversation throws', async () => {
    const view = createRestoreHarness(() => Promise.reject(new Error('corrupt archive')));

    view.startTabRestore();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.applyChatAppearance).toHaveBeenCalled();
    expect(view.tabManager.primeProviderRuntime).toHaveBeenCalled();
  });

  it('waits for layout when Obsidian is still building it', () => {
    const view = createRestoreHarness(() => Promise.resolve());
    const onLayoutReady = jest.fn();
    view.plugin.app.workspace = { layoutReady: false, onLayoutReady };

    view.startTabRestore();

    expect(view.restoreOrCreateTabs).not.toHaveBeenCalled();
    expect(onLayoutReady).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression: every restart came back with one blank tab. The Homepage plugin
 * ("Replace all open notes") rebuilds the whole workspace with changeLayout() at
 * layout-ready, so the first Claudian pane was closed before its deferred restore
 * ran. Its onClose saved the still-empty tab list over the good layout, and the
 * rebuilt pane restored nothing.
 */
describe('ClaudianView tab layout saving', () => {
  const layout = (openTabs: Array<{ tabId: string; conversationId: string | null }>) => ({
    openTabs,
    activeTabId: openTabs[0]?.tabId ?? null,
  });

  function createSaveHarness(state = layout([{ tabId: 'tab-1', conversationId: 'conv-1' }])) {
    const view = Object.create(ClaudianView.prototype) as any;
    const persistTabManagerState = jest.fn().mockResolvedValue(undefined);
    view.plugin = {
      app: { workspace: { layoutReady: true } },
      persistTabManagerState,
    };
    view.pendingPersist = null;
    view.tabManager = {
      getPersistedState: jest.fn().mockReturnValue(state),
      primeProviderRuntime: jest.fn(),
    };
    view.restoreOrCreateTabs = jest.fn().mockResolvedValue(undefined);
    view.syncProviderBrandColor = jest.fn();
    view.applyChatAppearance = jest.fn();
    view.updateLayoutForPosition = jest.fn();
    view.applyWorkspaceMode = jest.fn();
    return { view, persistTabManagerState };
  }

  async function finishRestore(view: any): Promise<void> {
    view.startTabRestore();
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }

  it('does not save when the pane closes before its own restore ran', async () => {
    const { view, persistTabManagerState } = createSaveHarness(layout([]));
    view.plugin.app.workspace = { layoutReady: false, onLayoutReady: jest.fn() };
    view.startTabRestore();

    await view.persistTabStateImmediate();

    expect(persistTabManagerState).not.toHaveBeenCalled();
  });

  it('saves once its own restore has finished', async () => {
    const { view, persistTabManagerState } = createSaveHarness();
    await finishRestore(view);

    await view.persistTabStateImmediate();

    expect(persistTabManagerState).toHaveBeenCalledWith(layout([{ tabId: 'tab-1', conversationId: 'conv-1' }]));
  });

  it('never saves an empty tab list, even after restore', async () => {
    const { view, persistTabManagerState } = createSaveHarness(layout([]));
    await finishRestore(view);

    await view.persistTabStateImmediate();

    expect(persistTabManagerState).not.toHaveBeenCalled();
  });

  it('applies the same rule to the debounced save', async () => {
    jest.useFakeTimers();
    try {
      const { view, persistTabManagerState } = createSaveHarness();
      view.persistTabState();
      jest.advanceTimersByTime(400);
      expect(persistTabManagerState).not.toHaveBeenCalled();

      view.startTabRestore();
      await Promise.resolve();
      await Promise.resolve();
      view.persistTabState();
      jest.advanceTimersByTime(400);
      expect(persistTabManagerState).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exposes nothing to save for the plugin until restore has finished', async () => {
    const { view } = createSaveHarness();
    expect(view.getSavableTabState()).toBeNull();

    await finishRestore(view);

    expect(view.getSavableTabState()).toEqual(layout([{ tabId: 'tab-1', conversationId: 'conv-1' }]));
  });
});

// Settings and environment changes used to redraw the model UI of every open
// tab; with many tabs that was the lag after each change.
describe('ClaudianView lazy tab refresh', () => {
  function harness() {
    const view = Object.create(ClaudianView.prototype) as any;
    const tabs = [{ id: 'tab-1' }, { id: 'tab-2' }];
    view.tabsNeedingModelRefresh = new Set<string>();
    view.tabManager = {
      getActiveTabId: jest.fn().mockReturnValue('tab-1'),
      getAllTabs: jest.fn().mockReturnValue(tabs),
      primeProviderRuntime: jest.fn(),
    };
    view.refreshTabModelUI = jest.fn();
    return { view, tabs };
  }

  it('redraws only the visible tab and remembers the hidden ones', () => {
    const { view, tabs } = harness();

    view.refreshModelSelector();

    expect(view.refreshTabModelUI).toHaveBeenCalledTimes(1);
    expect(view.refreshTabModelUI).toHaveBeenCalledWith(tabs[0]);
    expect([...view.tabsNeedingModelRefresh]).toEqual(['tab-2']);
  });

  it('does not rebuild the history list while it is closed', () => {
    const view = Object.create(ClaudianView.prototype) as any;
    view.historyDropdown = createMockEl();
    view.updateHistoryDropdown = jest.fn();

    view.refreshHistoryIfOpen();
    expect(view.updateHistoryDropdown).not.toHaveBeenCalled();

    view.historyDropdown.addClass('visible');
    view.refreshHistoryIfOpen();
    expect(view.updateHistoryDropdown).toHaveBeenCalledTimes(1);
  });
});
