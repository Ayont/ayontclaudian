import type { EventRef, WorkspaceLeaf } from 'obsidian';
import { ItemView, Menu, Notice, Scope, setIcon } from 'obsidian';

import { runSerializedSettingsMutation } from '../../app/settings/SettingsMutationQueue';
import { perfMark, perfSince } from '../../core/diagnostics/perfLog';
import { getHiddenProviderCommandSet } from '../../core/providers/commands/hiddenCommands';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../core/providers/ProviderSettingsCoordinator';
import { type AppTabManagerState, DEFAULT_CHAT_PROVIDER_ID, type ProviderId } from '../../core/providers/types';
import {
  applyChatAppearanceToContainer,
  type ChatAppearanceSettings,
  normalizeChatAppearance,
} from '../../core/theme/chatAppearance';
import { VIEW_TYPE_CLAUDIAN } from '../../core/types';
import { getWorkspaceModeMeta, normalizeWorkspaceMode, type WorkspaceMode } from '../../core/workspace/workspaceMode';
import type ClaudianPlugin from '../../main';
import { createProviderIconSvg } from '../../shared/icons';
import { confirm } from '../../shared/modals/ConfirmModal';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../utils/animationFrame';
import { revealWorkspaceLeaf } from '../../utils/obsidianCompat';
import type { HistoryConversationOpenState } from './controllers/ConversationController';
import {
  getTabProviderId,
  getTabTitle,
  onProviderAvailabilityChanged,
  sendTabInputMessageFromExplicitEnterShortcut,
  syncComposerModeClasses,
  updatePlanModeUI,
} from './tabs/Tab';
import { TabBar } from './tabs/TabBar';
import { TabManager } from './tabs/TabManager';
import { TabOverview } from './tabs/TabOverview';
import type { TabData, TabId } from './tabs/types';
import { CHAT_KEY_BINDINGS, chatKeyBindingScopeModifiers, matchesChatKeyBinding } from './ui/chatKeyBindings';
import { ModelSelectModal } from './ui/ModelSelectModal';
import { ShortcutOverlay } from './ui/ShortcutOverlay';
import { UpdateDock } from './ui/UpdateDock';
import { applyWorkspaceModeToContainer, WorkspaceModeToggle } from './ui/WorkspaceModeToggle';
import { recalculateUsageForModel } from './utils/usageInfo';

type LoadableView = {
  containerEl?: HTMLElement;
  load: () => Promise<void> | void;
};

export class ClaudianView extends ItemView {
  private plugin: ClaudianPlugin;

  // Tab management
  private tabManager: TabManager | null = null;
  private tabBar: TabBar | null = null;
  private tabOverview: TabOverview | null = null;
  private workspaceModeToggle: WorkspaceModeToggle | null = null;
  private tabBarContainerEl: HTMLElement | null = null;
  private tabContentEl: HTMLElement | null = null;
  private navRowContent: HTMLElement | null = null;

  // DOM Elements
  private viewContainerEl: HTMLElement | null = null;
  private headerEl: HTMLElement | null = null;
  private titleSlotEl: HTMLElement | null = null;
  private logoEl: HTMLElement | null = null;
  private titleTextEl: HTMLElement | null = null;
  private chatTitleDividerEl: HTMLElement | null = null;
  private chatTitleEl: HTMLElement | null = null;
  private headerActionsEl: HTMLElement | null = null;
  private headerActionsContent: HTMLElement | null = null;
  private newTabButtonEl: HTMLButtonElement | null = null;
  private pluginUpdateButtonEl: HTMLButtonElement | null = null;
  private historyButtonEl: HTMLButtonElement | null = null;
  private updateDock: UpdateDock | null = null;
  private unsubscribeUpdates: (() => void) | null = null;
  private unsubscribeDrafts: (() => void) | null = null;

  // Header elements
  private historyDropdown: HTMLElement | null = null;
  private shortcutOverlay: ShortcutOverlay | null = null;

  // Event refs for cleanup
  private eventRefs: EventRef[] = [];

  // Debouncing for tab bar updates
  private pendingTabBarUpdate: ScheduledAnimationFrame | null = null;

  // Debouncing for tab state persistence
  private pendingPersist: number | null = null;
  /**
   * False until this pane's own restore has run. Another plugin can rebuild the
   * workspace at startup (Homepage's "Replace all open notes" calls
   * changeLayout(), which recreates sidebar panes too) and close this pane before
   * it restored; saving then would write an empty tab list over the real layout.
   */
  private tabLayoutRestored = false;
  private tabRestore: Promise<void> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudianPlugin) {
    super(leaf);
    this.plugin = plugin;

    // Hover Editor compatibility: Define load as an instance method that can't be
    // overwritten by prototype patching. Hover Editor patches ClaudianView.prototype.load
    // after our class is defined, but instance methods take precedence over prototype methods.
    const prototype = Object.getPrototypeOf(this) as LoadableView;
    const originalLoad = prototype.load.bind(this) as () => Promise<void> | void;
    Object.defineProperty(this, 'load', {
      value: async () => {
        // Ensure containerEl exists before any patched load code tries to use it
        if (!this.containerEl) {
          (this as LoadableView).containerEl = createDiv({ cls: 'view-content' });
        }
        // Wrap in try-catch to prevent Hover Editor errors from breaking our view
        try {
          return await originalLoad();
        } catch {
          // Hover Editor may throw if its DOM setup fails - continue anyway
        }
      },
      writable: false,
      configurable: false,
    });
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN;
  }

  getDisplayText(): string {
    return 'Claudian';
  }

  getIcon(): string {
    return 'bot';
  }

  /**
   * Hidden tabs whose model UI is out of date. Settings and environment
   * changes used to redraw the selectors of every open tab; only the visible
   * one needs it now, the rest catch up when they are switched to.
   */
  private readonly tabsNeedingModelRefresh = new Set<string>();

  /** Refreshes model-dependent UI (used after settings/env changes). */
  refreshModelSelector(): void {
    const activeId = this.tabManager?.getActiveTabId() ?? null;
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      if (tab.id === activeId) {
        this.tabsNeedingModelRefresh.delete(tab.id);
        this.refreshTabModelUI(tab);
      } else {
        this.tabsNeedingModelRefresh.add(tab.id);
      }
    }

    this.tabManager?.primeProviderRuntime();
  }

  private refreshTabModelUI(tab: TabData): void {
    onProviderAvailabilityChanged(tab, this.plugin);
    const providerId = getTabProviderId(tab, this.plugin);
    const providerSettings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      providerId,
    );
    const model = providerSettings.model;
    const uiConfig = ProviderRegistry.getChatUIConfig(providerId);
    const contextWindow = uiConfig.getContextWindowSize(
      model,
      providerSettings.customContextLimits,
      providerSettings,
    );

    if (tab.state.usage) {
      tab.state.usage = recalculateUsageForModel(tab.state.usage, model, contextWindow);
    }

    tab.ui.modelSelector?.updateDisplay();
    tab.ui.modelSelector?.renderOptions();
    tab.ui.modeSelector?.updateDisplay();
    tab.ui.modeSelector?.renderOptions();
    tab.ui.thinkingBudgetSelector?.updateDisplay();
    tab.ui.permissionToggle?.updateDisplay();
    tab.ui.serviceTierToggle?.updateDisplay();
    syncComposerModeClasses(tab, this.plugin);
  }

  /** The history list is rebuilt whenever it opens; while closed, redrawing it is waste. */
  refreshHistoryIfOpen(): void {
    if (this.historyDropdown?.hasClass('visible')) {
      this.updateHistoryDropdown();
    }
  }

  invalidateProviderCommandCaches(providerIds?: ProviderId[]): void {
    this.tabManager?.invalidateProviderCommandCaches(providerIds);
  }

  /** Updates provider-scoped hidden commands on all tabs after settings changes. */
  updateHiddenProviderCommands(): void {
    for (const tab of this.tabManager?.getAllTabs() ?? []) {
      tab.ui.slashCommandDropdown?.setHiddenCommands(
        getHiddenProviderCommandSet(this.plugin.settings, getTabProviderId(tab, this.plugin)),
      );
    }
  }

  async onOpen() {
    // Guard: Hover Editor and similar plugins may call onOpen before DOM is ready.
    // containerEl must exist before we can access contentEl or create elements.
    if (!this.containerEl) {
      return;
    }

    // Use contentEl (standard Obsidian API) as primary target.
    // Hover Editor and other plugins may modify the DOM structure,
    // so we need fallbacks to handle non-standard scenarios.
    let container: HTMLElement | null =
      this.contentEl ?? (this.containerEl.children[1] as HTMLElement | null);

    if (!container) {
      // Last resort: create our own container inside containerEl
      container = this.containerEl.createDiv();
    }

    this.viewContainerEl = container;
    this.viewContainerEl.empty();
    this.viewContainerEl.addClass('claudian-container');
    this.shortcutOverlay = new ShortcutOverlay(this.viewContainerEl);

    const header = this.viewContainerEl.createDiv({ cls: 'claudian-header' });
    this.buildHeader(header);

    this.navRowContent = this.buildNavRowContent();
    this.tabContentEl = this.viewContainerEl.createDiv({ cls: 'claudian-tab-content-container' });
    this.mountUpdateDock(this.viewContainerEl);

    this.tabManager = new TabManager(
      this.plugin,
      this.tabContentEl,
      this,
      {
        onTabCreated: () => {
          this.updateTabBar();
          this.updateNavRowLocation();
          this.persistTabState();
          this.syncProviderBrandColor();
          // New tab DOM gets the mode placeholder + classes of the active mode.
          this.applyWorkspaceMode();
        },
        onTabSwitched: (_previousTabId, tabId) => {
          const switched = this.tabManager?.getTab(tabId);
          if (switched && this.tabsNeedingModelRefresh.delete(tabId)) {
            this.refreshTabModelUI(switched);
          }
          this.updateTabBar();
          this.refreshHistoryIfOpen();
          this.updateNavRowLocation();
          this.persistTabState();
          this.syncProviderBrandColor();
          // The mode is chat-scoped — re-skin to the newly active chat's mode.
          this.applyWorkspaceMode();
        },
        onTabClosed: () => {
          this.updateTabBar();
          this.persistTabState();
        },
        onTabStreamingChanged: () => this.updateTabBar(),
        onTabTitleChanged: () => this.updateTabBar(),
        onTabAttentionChanged: () => this.updateTabBar(),
        onTabConversationChanged: () => {
          this.updateTabBar();
          this.persistTabState();
          this.syncProviderBrandColor();
          this.applyWorkspaceMode();
        },
        onTabProviderChanged: () => {
          this.updateTabBar();
          this.syncProviderBrandColor();
        },
      }
    );

    this.wireEventHandlers();

    this.startTabRestore();
  }

  /**
   * Rebuilds the previously open chats — deliberately NOT awaited by onOpen().
   *
   * Obsidian resolves `setViewState()` only after `onOpen()` returns, and the
   * ribbon click reveals the leaf only after that. Restoring a long
   * conversation re-renders megabytes of stored messages, so awaiting it here
   * kept the pane invisible for as long as that took: the click looked like it
   * did nothing. The shell is complete at this point; the chats fill in behind
   * it, and a corrupt archive costs the history, not the window.
   */
  private startTabRestore(): void {
    let markRestored: () => void = () => {};
    this.tabRestore = new Promise<void>((resolve) => { markRestored = resolve; });
    const restoreTabs = async () => {
      const restoreStart = perfMark();
      try {
        await this.restoreOrCreateTabs();
        perfSince(restoreStart, 'startup-tab-restore', `${this.tabManager?.getTabCount() ?? 0} tabs`);
      } catch {
        new Notice('Der zuletzt offene Chat konnte nicht wiederhergestellt werden.');
      } finally {
        this.tabLayoutRestored = true;
        markRestored();
      }
      this.syncProviderBrandColor();
      this.applyChatAppearance();
      this.updateLayoutForPosition();
      this.applyWorkspaceMode();
      this.tabManager?.primeProviderRuntime();
    };

    if (this.plugin.app.workspace.layoutReady) {
      void restoreTabs();
    } else {
      this.plugin.app.workspace.onLayoutReady(() => {
        void restoreTabs();
      });
    }
  }

  /**
   * Mode of the ACTIVE chat: per-conversation value first, then the global
   * default (covers blank tabs and pre-mode conversations).
   */
  private resolveActiveWorkspaceMode(): WorkspaceMode {
    const conversationId = this.tabManager?.getActiveTab()?.conversationId ?? null;
    const conversation = conversationId ? this.plugin.getConversationSync(conversationId) : null;
    return normalizeWorkspaceMode(conversation?.workspaceMode ?? this.plugin.settings.workspaceMode);
  }

  /**
   * Sets the mode for the ACTIVE chat (persisted on its conversation) and as
   * the global default for future chats, then re-skins the view. When the
   * target mode has a pinned model, the active tab switches to it through the
   * same path as the model picker.
   */
  async setWorkspaceMode(next: WorkspaceMode): Promise<void> {
    this.plugin.settings.workspaceMode = next;
    await this.plugin.saveSettings();
    const activeTab = this.tabManager?.getActiveTab() ?? null;
    if (activeTab?.conversationId) {
      await this.plugin.updateConversation(activeTab.conversationId, { workspaceMode: next });
    }
    this.applyWorkspaceMode(next);
    await this.applyModeModelPreference(next);
  }

  /** Switches the active tab to the mode's pinned model, if one is configured. */
  private async applyModeModelPreference(mode: WorkspaceMode): Promise<void> {
    const pinned = this.plugin.settings.workspaceModeModels?.[mode]?.trim();
    if (!pinned) {
      return;
    }
    const tab = this.tabManager?.getActiveTab();
    if (!tab || tab.state.isStreaming) {
      return;
    }
    try {
      await tab.ui.modelSelector?.selectModel(pinned);
    } catch {
      new Notice(`Modell ${pinned} konnte nicht aktiviert werden.`);
    }
  }

  private async persistWorkspaceModeModelBinding(
    mode: WorkspaceMode,
    model: string | null,
  ): Promise<void> {
    await runSerializedSettingsMutation(this.plugin.settings, async () => {
      const previousModeModels = this.plugin.settings.workspaceModeModels;
      const candidateModeModels = { ...previousModeModels };
      if (model) {
        candidateModeModels[mode] = model;
      } else {
        delete candidateModeModels[mode];
      }
      this.plugin.settings.workspaceModeModels = candidateModeModels;

      try {
        await this.plugin.saveSettings();
      } catch (error) {
        this.plugin.settings.workspaceModeModels = previousModeModels;
        new Notice('Modell-Bindung konnte nicht gespeichert werden.');
        throw error;
      }
    });

    this.workspaceModeToggle?.render();
    if (model) {
      const meta = getWorkspaceModeMeta(mode);
      new Notice(`${meta.label}-Modus nutzt jetzt ${model}.`);
      if (this.resolveActiveWorkspaceMode() === mode) {
        await this.applyModeModelPreference(mode);
      }
      return;
    }

    const meta = getWorkspaceModeMeta(mode);
    new Notice(`${meta.label}-Modus folgt wieder dem Tab-Modell.`);
  }

  /** Context menu on a mode segment: pin/unpin a model for that mode. */
  private openModeModelMenu(mode: WorkspaceMode, anchor: MouseEvent | HTMLElement): void {
    const meta = getWorkspaceModeMeta(mode);
    const pinned = this.plugin.settings.workspaceModeModels?.[mode]?.trim() || null;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(`Modell für ${meta.label}-Modus festlegen…`)
        .setIcon('cpu')
        .onClick(() => {
          const models = ProviderRegistry.getAggregatedModelOptions(
            this.plugin.settings as unknown as Record<string, unknown>,
          );
          new ModelSelectModal(this.plugin.app, models, pinned ?? '', (value) =>
            this.persistWorkspaceModeModelBinding(mode, value)
          ).open();
        }),
    );
    if (pinned) {
      menu.addItem((item) =>
        item
          .setTitle(`Modell-Bindung entfernen (${pinned})`)
          .setIcon('x')
          .onClick(() => {
            void this.persistWorkspaceModeModelBinding(mode, null).catch(() => {
              // The helper restored state and surfaced a user-facing notice.
            });
          }),
      );
    }
    if ('clientX' in anchor) {
      menu.showAtMouseEvent(anchor);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    menu.showAtPosition(
      { x: rect.left, y: rect.bottom },
      anchor.ownerDocument,
    );
  }

  /**
   * Toggles between Code and Work mode. Used by the header pill and the
   * command palette ("Workspace-Modus umschalten").
   */
  async toggleWorkspaceMode(): Promise<void> {
    const next: WorkspaceMode = this.resolveActiveWorkspaceMode() === 'code' ? 'work' : 'code';
    await this.setWorkspaceMode(next);
  }

  /**
   * Applies the active workspace mode (Code/Work) to the whole view:
   * container accent class, input placeholders, quick actions and toggle
   * state. Also mirrors the mode into the in-memory settings so the system
   * prompt builders (which read plugin.settings at query time) pick up the
   * ACTIVE chat's mode — persisted only on explicit switches.
   */
  private applyWorkspaceMode(mode?: WorkspaceMode): void {
    if (!this.viewContainerEl) {
      return;
    }
    const active = mode ?? this.resolveActiveWorkspaceMode();
    this.plugin.settings.workspaceMode = active;
    // Animate only on an explicit switch (mode passed), not on open/tab-create.
    applyWorkspaceModeToContainer(this.viewContainerEl, active, { animate: mode !== undefined });
    this.workspaceModeToggle?.render();
  }

  async onClose() {
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
      this.pendingTabBarUpdate = null;
    }

    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
    }
    this.eventRefs = [];

    await this.persistTabStateImmediate();

    await this.tabManager?.destroy();
    this.tabManager = null;

    this.tabBar?.destroy();
    this.tabBar = null;
    this.tabOverview?.destroy();
    this.tabOverview = null;
    this.unsubscribeUpdates?.();
    this.unsubscribeUpdates = null;
    this.unsubscribeDrafts?.();
    this.unsubscribeDrafts = null;
    this.updateDock = null;
    this.scope = null;
  }

  private shouldToggleShortcutOverlay(event: KeyboardEvent): boolean {
    if (event.isComposing) {
      return false;
    }
    if (matchesChatKeyBinding(event, 'shortcuts')) {
      return true;
    }
    if (event.key !== '?') return false;
    // Duck-typed: popout windows have their own HTMLElement constructor.
    const target = event.target as Partial<HTMLElement> | null;
    const typingInField = target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable === true;
    return !typingInField;
  }

  // ============================================
  // UI Building
  // ============================================

  private buildHeader(header: HTMLElement) {
    this.headerEl = header;

    // Title slot container (logo + title or tabs)
    this.titleSlotEl = header.createDiv({ cls: 'claudian-title-slot' });

    // Logo (hidden when 2+ tabs) — populated by syncHeaderLogo()
    this.logoEl = this.titleSlotEl.createSpan({ cls: 'claudian-logo' });
    this.syncHeaderLogo(DEFAULT_CHAT_PROVIDER_ID);

    // Title text (hidden in header mode when 2+ tabs)
    this.titleTextEl = this.titleSlotEl.createEl('h4', { text: 'ayontclaudian', cls: 'claudian-title-text' });

    // Active chat title: "ayontclaudian ⟋ <Chat-Titel>" — divider + title of the
    // current conversation, kept in sync via the tab lifecycle callbacks.
    this.chatTitleDividerEl = this.titleSlotEl.createSpan({ cls: 'claudian-title-divider claudian-hidden' });
    this.chatTitleDividerEl.setAttribute('aria-hidden', 'true');
    this.chatTitleEl = this.titleSlotEl.createSpan({ cls: 'claudian-title-chat claudian-hidden' });

    // Workspace mode switch (Code | Work) — lives NEXT TO THE TITLE so the
    // active chat's mode is always one glance (and one click) away. The mode
    // is chat-scoped: it reads/writes the active conversation and only falls
    // back to the global default for blank tabs.
    this.workspaceModeToggle = new WorkspaceModeToggle(this.titleSlotEl, {
      getMode: () => this.resolveActiveWorkspaceMode(),
      onModeChange: (mode) => this.setWorkspaceMode(mode),
      getModeModel: (mode) => this.plugin.settings.workspaceModeModels?.[mode]?.trim() || null,
      onConfigureModel: (mode, anchor) => this.openModeModelMenu(mode, anchor),
    });

    // Header actions container (for header mode - initially hidden)
    this.headerActionsEl = header.createDiv({ cls: 'claudian-header-actions claudian-header-actions-slot claudian-hidden' });
  }

  /**
   * Builds the nav row content (tab badges + header actions).
   * This is called once and the content is moved between locations.
   */
  private buildNavRowContent(): HTMLElement {
    const activeDocument = this.containerEl.ownerDocument;

    // Create a fragment to hold nav row content
    const fragment = activeDocument.createDocumentFragment();

    // Tab badges (left side in nav row, or in title slot for header mode)
    this.tabBarContainerEl = activeDocument.createElement('div');
    this.tabBarContainerEl.className = 'claudian-tab-bar-container';
    // The badges scroll; the "+N" chip sits beside them in the container.
    const tabBadgesEl = this.tabBarContainerEl.createDiv();
    this.tabBar = new TabBar(tabBadgesEl, {
      onTabClick: (tabId) => this.handleTabClick(tabId),
      onTabClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Tab konnte nicht erstellt werden.'));
      },
      onOpenOverview: () => this.tabOverview?.open(),
      onTabContextMenu: (tabId, event) => this.showTabContextMenu(tabId, event),
    }, { overflowHostEl: this.tabBarContainerEl });
    fragment.appendChild(this.tabBarContainerEl);

    // Header actions (right side)
    this.headerActionsContent = activeDocument.createElement('div');
    this.headerActionsContent.className = 'claudian-header-actions';

    // New tab button (plus icon)
    this.newTabButtonEl = this.headerActionsContent.createEl('button', {
      cls: 'claudian-header-btn claudian-new-tab-btn',
      attr: {
        'aria-label': 'Neuer Tab',
        title: 'Neuen Tab öffnen',
        type: 'button',
      },
    });
    setIcon(this.newTabButtonEl, 'square-plus');
    this.newTabButtonEl.addEventListener('click', () => {
      void this.createNewTab().catch(() => new Notice('Tab konnte nicht erstellt werden.'));
    });

    this.tabOverview = new TabOverview(this.headerActionsContent, {
      getItems: () => this.tabManager?.getTabOverviewItems() ?? [],
      onSelect: (tabId) => this.activateTabAndFocusComposer(tabId),
      onClose: (tabId) => {
        void this.handleTabClose(tabId);
      },
      onNewTab: () => {
        void this.createNewTab().catch(() => new Notice('Tab konnte nicht erstellt werden.'));
      },
      canCreateTab: () => this.tabManager?.canCreateTab() ?? false,
      onOpen: () => this.closeHistoryDropdown(false),
    });

    this.pluginUpdateButtonEl = this.headerActionsContent.createEl('button', {
      cls: 'claudian-header-btn claudian-update-btn claudian-hidden',
      attr: {
        'aria-label': 'Plugin-Update installieren',
        title: 'Plugin-Update installieren',
        type: 'button',
      },
    });
    setIcon(this.pluginUpdateButtonEl, 'download');
    this.pluginUpdateButtonEl.addEventListener('click', () => {
      this.plugin.installPendingPluginUpdate();
    });
    this.setPluginUpdateAvailable(this.plugin.getPendingPluginUpdate());

    // New conversation button (square-pen icon - new conversation in current tab)
    const newBtn = this.headerActionsContent.createEl('button', {
      cls: 'claudian-header-btn',
      attr: {
        'aria-label': 'Neue Unterhaltung',
        title: 'Neue Unterhaltung starten',
        type: 'button',
      },
    });
    setIcon(newBtn, 'square-pen');
    newBtn.addEventListener('click', () => {
      void (async () => {
        await this.tabManager?.createNewConversation();
        this.refreshHistoryIfOpen();
      })().catch(() => new Notice('Unterhaltung konnte nicht erstellt werden.'));
    });

    // History dropdown
    const historyContainer = this.headerActionsContent.createDiv({ cls: 'claudian-history-container' });
    this.historyButtonEl = historyContainer.createEl('button', {
      cls: 'claudian-header-btn',
      attr: {
        'aria-expanded': 'false',
        'aria-haspopup': 'dialog',
        'aria-label': 'Chat-Verlauf',
        title: 'Chat-Verlauf öffnen',
        type: 'button',
      },
    });
    setIcon(this.historyButtonEl, 'history');

    this.historyDropdown = historyContainer.createDiv({ cls: 'claudian-history-menu' });
    this.historyDropdown.setAttribute('role', 'dialog');
    this.historyDropdown.setAttribute('aria-label', 'Chat-Verlauf');

    this.historyButtonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleHistoryDropdown();
    });

    const shortcutBtn = this.headerActionsContent.createEl('button', {
      cls: 'claudian-header-btn',
      attr: {
        'aria-label': 'Tastenkürzel',
        title: 'Tastenkürzel anzeigen',
        type: 'button',
      },
    });
    setIcon(shortcutBtn, 'keyboard');
    shortcutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.shortcutOverlay?.toggle();
    });

    fragment.appendChild(this.headerActionsContent);

    // Create a wrapper div to hold the fragment (for input mode nav row)
    const wrapper = activeDocument.createElement('div');
    wrapper.className = 'claudian-input-nav-content';
    wrapper.appendChild(fragment);
    return wrapper;
  }

  /**
   * Moves nav row content based on tabBarPosition setting.
   * - 'input' mode: Both tab badges and actions go to active tab's navRowEl
   * - 'header' mode: Tab badges go to title slot (after logo), actions go to header right side
   */
  private updateNavRowLocation(): void {
    if (!this.tabBarContainerEl || !this.headerActionsContent) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    if (isHeaderMode) {
      // Header mode: Tab badges go to title slot, actions go to header right side
      if (this.titleSlotEl) {
        this.titleSlotEl.appendChild(this.tabBarContainerEl);
      }
      if (this.headerActionsEl) {
        this.headerActionsEl.appendChild(this.headerActionsContent);
        this.headerActionsEl.removeClass('claudian-hidden');
      }
    } else {
      // Input mode: Both go to active tab's navRowEl via the wrapper
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab && this.navRowContent) {
        // Re-assemble the nav row content wrapper
        this.navRowContent.appendChild(this.tabBarContainerEl);
        this.navRowContent.appendChild(this.headerActionsContent);
        activeTab.dom.navRowEl.appendChild(this.navRowContent);
      }
      // Hide header actions slot when in input mode
      if (this.headerActionsEl) {
        this.headerActionsEl.addClass('claudian-hidden');
      }
    }
  }

  /**
   * Updates layout when tabBarPosition setting changes.
   * Called from settings when user changes the tab bar position.
   */
  updateLayoutForPosition(): void {
    if (!this.viewContainerEl) return;

    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Update container class for CSS styling
    this.viewContainerEl.toggleClass('claudian-container--header-mode', isHeaderMode);

    // Move nav content to appropriate location
    this.updateNavRowLocation();

    // Update tab bar and title visibility
    this.updateTabBarVisibility();
  }

  /** Refreshes tab controls after settings that affect tab availability change. */
  refreshTabControls(): void {
    this.updateTabBarVisibility();
  }

  // ============================================
  // Tab Management
  // ============================================

  private handleTabClick(tabId: TabId): void {
    const switched = this.tabManager?.switchToTab(tabId);
    if (switched) {
      void switched.catch(() => new Notice('Tab-Wechsel fehlgeschlagen.'));
    }
  }

  private showTabContextMenu(tabId: TabId, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle('Tab schließen')
      .setIcon('x')
      .onClick(() => { void this.handleTabClose(tabId); }));
    if (this.tabOverview) {
      menu.addItem((item) => item
        .setTitle('Tab-Übersicht öffnen')
        .setIcon('list')
        .onClick(() => this.tabOverview?.open()));
    }
    menu.showAtMouseEvent(event);
  }

  private async handleTabClose(tabId: TabId): Promise<void> {
    try {
      // Closing keeps the chat in the history, but a running answer would be
      // cut off: ask first.
      const tab = this.tabManager?.getTab(tabId);
      if (tab?.state.isStreaming) {
        const confirmed = await confirm(
          this.app,
          'In diesem Tab läuft noch eine Antwort. Stoppen und Tab schließen? Der Chat bleibt im Verlauf.',
          'Stoppen & schließen',
        );
        if (!confirmed) return;
      }
      await this.tabManager?.closeTab(tabId, true);
      this.updateTabBarVisibility();
    } catch (err) {
      console.error('[Claudian] Failed to close tab:', err);
      new Notice('Tab konnte nicht geschlossen werden.');
    }
  }

  async createNewTab(): Promise<void> {
    const tab = await this.tabManager?.createTab();
    if (!tab) {
      const maxTabs = this.plugin.settings.maxTabs ?? 3;
      new Notice(`Maximum ${maxTabs} tabs allowed`);
      this.updateTabBarVisibility();
      return;
    }
    this.updateTabBarVisibility();
  }

  private updateTabBar(): void {
    if (!this.tabManager || !this.tabBar) return;

    // Debounce tab bar updates using requestAnimationFrame
    if (this.pendingTabBarUpdate !== null) {
      cancelScheduledAnimationFrame(this.pendingTabBarUpdate);
    }

    this.pendingTabBarUpdate = scheduleAnimationFrame(() => {
      this.pendingTabBarUpdate = null;
      if (!this.tabManager || !this.tabBar) return;

      const items = this.tabManager.getTabBarItems();
      this.tabBar.update(items);
      this.tabOverview?.syncButton(items.length, items.filter((item) => item.attentionReason !== null).length);
      this.tabOverview?.refresh();
      this.updateTabBarVisibility();
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  /**
   * Syncs the header's chat-title segment ("ayontclaudian ⟋ Titel") with the
   * active tab's conversation. Hidden for unnamed chats and whenever the
   * branding itself is hidden (header-mode tab badges).
   */
  private updateHeaderChatTitle(): void {
    if (!this.chatTitleEl || !this.chatTitleDividerEl) return;

    const activeTab = this.tabManager?.getActiveTab() ?? null;
    const title = activeTab ? getTabTitle(activeTab, this.plugin) : null;
    const brandingHidden = this.titleTextEl?.hasClass('claudian-hidden') ?? false;
    const shouldShow = !!title && title !== 'New Chat' && !brandingHidden;

    this.chatTitleDividerEl.toggleClass('claudian-hidden', !shouldShow);
    this.chatTitleEl.toggleClass('claudian-hidden', !shouldShow);
    if (!shouldShow) return;

    if (this.chatTitleEl.textContent !== title) {
      this.chatTitleEl.setText(title);
      this.chatTitleEl.setAttribute('title', title);
      // Re-trigger the entrance fade so title changes feel alive.
      this.chatTitleEl.removeClass('is-updated');
      void this.chatTitleEl.offsetWidth;
      this.chatTitleEl.addClass('is-updated');
    }
  }

  private updateTabBarVisibility(): void {
    if (!this.tabBarContainerEl || !this.tabManager) return;

    const tabCount = this.tabManager.getTabCount();
    const showTabBar = tabCount >= 2;
    const isHeaderMode = this.plugin.settings.tabBarPosition === 'header';

    // Hide tab badges when only 1 tab, show when 2+
    this.tabBarContainerEl.toggleClass('claudian-hidden', !showTabBar);

    // In header mode, badges replace logo/title in the same location
    // In input mode, keep logo/title visible (badges are in nav row)
    const hideBranding = showTabBar && isHeaderMode;
    if (this.logoEl) {
      this.logoEl.toggleClass('claudian-hidden', hideBranding);
    }
    if (this.titleTextEl) {
      this.titleTextEl.toggleClass('claudian-hidden', hideBranding);
    }

    // Chat-title segment follows every tab lifecycle event: all callbacks
    // funnel through updateTabBar() → here (rAF-debounced).
    this.updateHeaderChatTitle();

    this.updateNewTabButtonVisibility();
  }

  private updateNewTabButtonVisibility(): void {
    if (!this.newTabButtonEl || !this.tabManager) return;

    const canCreateTab = this.tabManager.canCreateTab();
    this.newTabButtonEl.toggleClass('claudian-hidden', !canCreateTab);
    this.newTabButtonEl.disabled = !canCreateTab;
    if (canCreateTab) {
      this.newTabButtonEl.removeAttribute('aria-disabled');
      this.newTabButtonEl.removeAttribute('aria-hidden');
      return;
    }

    this.newTabButtonEl.setAttribute('aria-disabled', 'true');
    this.newTabButtonEl.setAttribute('aria-hidden', 'true');
  }

  /** Sets `data-provider` on the root container so CSS brand color follows the active provider. */
  private syncProviderBrandColor(): void {
    if (!this.viewContainerEl) return;
    const activeTab = this.tabManager?.getActiveTab();
    const providerId = activeTab ? getTabProviderId(activeTab, this.plugin) : DEFAULT_CHAT_PROVIDER_ID;
    this.viewContainerEl.dataset.provider = providerId;
    this.syncHeaderLogo(providerId);
    this.applyChatAppearance();
  }

  setPluginUpdateAvailable(update: { latestVersion: string; currentVersion: string } | null): void {
    if (!this.pluginUpdateButtonEl) {
      return;
    }
    this.pluginUpdateButtonEl.toggleClass('claudian-hidden', !update);
    if (update) {
      this.pluginUpdateButtonEl.setAttribute(
        'aria-label',
        `ayontclaudian ${update.latestVersion} installieren`,
      );
      this.pluginUpdateButtonEl.setAttribute(
        'title',
        `Update ${update.latestVersion} (aktuell ${update.currentVersion})`,
      );
    }
  }

  private mountUpdateDock(container: HTMLElement): void {
    this.unsubscribeUpdates?.();
    this.updateDock = new UpdateDock({
      mountEl: container,
      onStartAll: () => this.plugin.startOfferedUpdates(),
      onStartOne: (id) => this.plugin.startOfferedUpdate(id),
      onDismiss: (id) => this.plugin.dismissOfferedUpdate(id),
    });
    this.updateDock.setState(this.plugin.getUpdateSession());
    this.unsubscribeUpdates = this.plugin.onUpdateSessionChange((state) => {
      this.updateDock?.setState(state);
    });
    // Pencil on tabs and history rows follows the drafts. The store only fires
    // when a chat gains or loses its draft, not on every keystroke.
    this.unsubscribeDrafts = this.plugin.composerDrafts?.subscribe(() => {
      this.updateTabBar();
      this.refreshHistoryIfOpen();
    }) ?? null;
  }

  /** Applies the user's chat theme (or clears it to follow the host/provider). */
  applyChatAppearance(appearance?: ChatAppearanceSettings, isLight?: boolean): void {
    if (!this.viewContainerEl) return;
    const body = this.viewContainerEl.ownerDocument.body;
    applyChatAppearanceToContainer(
      this.viewContainerEl,
      appearance ?? normalizeChatAppearance(this.plugin.settings.chatAppearance),
      isLight ?? body.classList.contains('theme-light'),
    );
  }

  /** Rebuilds the header logo SVG to match the given provider. */
  private syncHeaderLogo(providerId: ProviderId): void {
    if (!this.logoEl) return;
    const icon = ProviderRegistry.getChatUIConfig(providerId).getProviderIcon?.();
    if (!icon) return;
    const existing = this.logoEl.querySelector('svg');
    if (existing?.getAttribute('data-provider') === providerId) return;
    this.logoEl.empty();
    const svg = createProviderIconSvg(icon, {
      dataProvider: providerId,
      height: 18,
      ownerDocument: this.logoEl.ownerDocument,
      width: 18,
    });
    this.logoEl.appendChild(svg);
  }

  // ============================================
  // History Dropdown
  // ============================================

  private toggleHistoryDropdown(): void {
    if (!this.historyDropdown) return;

    const isVisible = this.historyDropdown.hasClass('visible');
    if (isVisible) {
      this.closeHistoryDropdown();
    } else {
      this.tabOverview?.close({ restoreFocus: false });
      this.updateHistoryDropdown();
      this.historyDropdown.addClass('visible');
      this.historyButtonEl?.setAttribute('aria-expanded', 'true');
      this.historyDropdown.querySelector<HTMLElement>('.claudian-history-search-input')?.focus();
    }
  }

  private closeHistoryDropdown(restoreFocus = true): boolean {
    if (!this.historyDropdown?.hasClass('visible')) return false;
    this.historyDropdown.removeClass('visible');
    this.historyButtonEl?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.historyButtonEl?.focus();
    return true;
  }

  private updateHistoryDropdown(): void {
    if (!this.historyDropdown) return;
    this.historyDropdown.empty();

    const activeTab = this.tabManager?.getActiveTab();
    const conversationController = activeTab?.controllers.conversationController;

    if (conversationController) {
      conversationController.renderHistoryDropdown(this.historyDropdown, {
        onSelectConversation: (id) => this.openHistoryConversation(id),
        onOpenConversationInNewTab: (id, activate) =>
          this.openHistoryConversationInNewTab(id, activate),
        getConversationOpenState: (id) => this.getHistoryConversationOpenState(id),
      });
    }
  }

  private async openHistoryConversation(conversationId: string): Promise<void> {
    await this.tabManager?.openConversation(conversationId);
    this.closeHistoryDropdown(false);
  }

  private async openHistoryConversationInNewTab(
    conversationId: string,
    activate = true,
  ): Promise<void> {
    await this.tabManager?.openConversation(conversationId, {
      preferNewTab: true,
      activate,
    });
    this.closeHistoryDropdown(false);
  }

  private getHistoryConversationOpenState(conversationId: string): HistoryConversationOpenState {
    const activeTab = this.tabManager?.getActiveTab();
    if (activeTab?.conversationId === conversationId) {
      return 'current';
    }

    if (this.findTabWithConversation(conversationId)) {
      return 'open';
    }

    const crossViewResult = this.plugin.findConversationAcrossViews(conversationId);
    if (crossViewResult && crossViewResult.view !== this) {
      return 'open';
    }

    return 'closed';
  }

  private findTabWithConversation(conversationId: string): TabData | null {
    const tabs = this.tabManager?.getAllTabs() ?? [];
    return tabs.find(tab => tab.conversationId === conversationId) ?? null;
  }

  // ============================================
  // Event Wiring
  // ============================================

  private wireEventHandlers(): void {
    const activeDocument = this.containerEl.ownerDocument;

    // DOM-level cancel-turn handler (e.g. from bash tool kill button)
    this.registerDomEvent(this.containerEl, 'claudian:cancel-turn' as any, () => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        activeTab.controllers.inputController?.cancelStreaming?.();
      }
    });

    // Document-level click to close dropdowns
    this.registerDomEvent(activeDocument, 'click', () => {
      this.closeHistoryDropdown(false);
      this.tabOverview?.close({ restoreFocus: false });
    });

    // A pane that was hidden while its active tab finished: any interaction
    // means the user has now seen it.
    const acknowledgeActiveTab = (): void => this.tabManager?.acknowledgeActiveTabAttention();
    this.registerDomEvent(this.containerEl, 'pointerdown', acknowledgeActiveTab);
    this.registerDomEvent(this.containerEl, 'focusin', acknowledgeActiveTab);

    // View-level Shift+Tab to toggle plan mode (works from any focused element)
    this.registerDomEvent(this.containerEl, 'keydown', (e: KeyboardEvent) => {
      if (this.shouldToggleShortcutOverlay(e)) {
        e.preventDefault();
        e.stopPropagation();
        this.shortcutOverlay?.toggle();
        return;
      }
      if (e.key === 'Escape' && this.shortcutOverlay?.isOpen()) {
        e.preventDefault();
        this.shortcutOverlay.close();
        return;
      }
      if (e.key === 'Escape' && this.closeHistoryDropdown()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (matchesChatKeyBinding(e, 'plan-mode')) {
        e.preventDefault();
        const activeTab = this.tabManager?.getActiveTab();
        if (!activeTab) return;
        const providerId = getTabProviderId(activeTab, this.plugin);
        if (!ProviderRegistry.getCapabilities(providerId).supportsPlanMode) return;
        const current = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
          this.plugin.settings,
          providerId,
        ).permissionMode as string;
        if (current === 'plan') {
          const restoreMode = activeTab.state.prePlanPermissionMode ?? 'normal';
          activeTab.state.prePlanPermissionMode = null;
          updatePlanModeUI(activeTab, this.plugin, restoreMode);
        } else {
          activeTab.state.prePlanPermissionMode = current;
          updatePlanModeUI(activeTab, this.plugin, 'plan');
        }
      }
    });

    // View scopes are the Obsidian-owned boundary for main-area tab hotkeys.
    // Returning false consumes Escape before Obsidian uses it for pane navigation.
    this.scope = new Scope(this.app.scope);
    this.scope.register(chatKeyBindingScopeModifiers('stop'), CHAT_KEY_BINDINGS.stop.key, (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // The overview handles its own Escape first (e.g. backing out of a close question).
      if (!e.defaultPrevented && this.tabOverview?.close()) return false;
      if (this.closeHistoryDropdown()) return false;
      if (!e.defaultPrevented) {
        const activeTab = this.tabManager?.getActiveTab();
        if (activeTab?.state.isStreaming) {
          activeTab.controllers.inputController?.cancelStreaming();
        }
      }
      return false;
    });
    this.scope.register(chatKeyBindingScopeModifiers('send'), CHAT_KEY_BINDINGS.send.key, (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented) return;
      const activeTab = this.tabManager?.getActiveTab();
      if (!activeTab) return;
      if (sendTabInputMessageFromExplicitEnterShortcut(activeTab, e, { requireInputFocus: true })) {
        return false;
      }
    });

    // Vault events - forward to active tab's file context manager
    const markCacheDirty = (includesFolders: boolean): void => {
      const mgr = this.tabManager?.getActiveTab()?.ui.fileContextManager;
      if (!mgr) return;
      mgr.markFileCacheDirty();
      if (includesFolders) mgr.markFolderCacheDirty();
    };
    this.eventRefs.push(
      this.plugin.app.vault.on('create', () => markCacheDirty(true)),
      this.plugin.app.vault.on('delete', () => markCacheDirty(true)),
      this.plugin.app.vault.on('rename', () => markCacheDirty(true)),
      this.plugin.app.vault.on('modify', () => markCacheDirty(false))
    );

    // File open event
    this.registerEvent(
      this.plugin.app.workspace.on('file-open', (file) => {
        if (file) {
          this.tabManager?.getActiveTab()?.ui.fileContextManager?.handleFileOpen(file);
        }
      })
    );

    // Click outside to close mention dropdown
    this.registerDomEvent(activeDocument, 'click', (e) => {
      const activeTab = this.tabManager?.getActiveTab();
      if (activeTab) {
        const fcm = activeTab.ui.fileContextManager;
        if (fcm && !fcm.containsElement(e.target as Node) && e.target !== activeTab.dom.inputEl) {
          fcm.hideMentionDropdown();
        }
      }
    });
  }

  // ============================================
  // Persistence
  // ============================================

  private async restoreOrCreateTabs(): Promise<void> {
    if (!this.tabManager) return;

    // Try to restore from persisted state
    const persistedState = await this.plugin.storage.getTabManagerState();
    if (persistedState && persistedState.openTabs.length > 0) {
      await this.tabManager.restoreState(persistedState);
      return;
    }

    // Fallback: create a new empty tab
    await this.tabManager.createTab();
  }

  private persistTabState(): void {

    // Debounce persistence to avoid rapid writes (300ms delay)
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
    }
    this.pendingPersist = window.setTimeout(() => {
      this.pendingPersist = null;
      const state = this.getSavableTabState();
      if (!state) return;
      this.plugin.persistTabManagerState(state).catch(() => {
        // Silently ignore persistence errors
      });
    }, 300);
  }

  /**
   * The tab layout to save, or null when saving would overwrite a good layout:
   * before this pane's own restore ran, or when it holds no tab at all (a
   * restored pane always has one; zero only occurs mid-teardown).
   */
  getSavableTabState(): AppTabManagerState | null {
    if (!this.tabLayoutRestored || !this.tabManager) return null;
    const state = this.tabManager.getPersistedState();
    return state.openTabs.length > 0 ? state : null;
  }

  /** Force immediate persistence (for onClose/onunload). */
  private async persistTabStateImmediate(): Promise<void> {
    // Cancel any pending debounced persist
    if (this.pendingPersist !== null) {
      window.clearTimeout(this.pendingPersist);
      this.pendingPersist = null;
    }
    const state = this.getSavableTabState();
    if (!state) return;
    await this.plugin.persistTabManagerState(state);
  }

  // ============================================
  // Public API
  // ============================================

  /** Gets the currently active tab. */
  getActiveTab(): TabData | null {
    return this.tabManager?.getActiveTab() ?? null;
  }

  /**
   * Resolves once the deferred tab restore has run, so an action that just
   * opened the pane (context menu, command) reaches a real tab.
   */
  whenTabsRestored(): Promise<void> {
    return this.tabRestore ?? Promise.resolve();
  }

  /** Gets the tab manager. */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Collapsed sidebar or hidden window: even the active tab is out of sight. */
  isChatVisible(): boolean {
    const el = this.containerEl as HTMLElement & { isShown?: () => boolean };
    if (el.ownerDocument?.visibilityState === 'hidden') return false;
    return typeof el.isShown === 'function' ? el.isShown() : true;
  }

  getOpenTabCount(): number {
    return this.tabManager?.getTabCount() ?? 0;
  }

  /** "Tab-Übersicht öffnen" works from anywhere, so the pane is revealed too. */
  openTabOverview(): void {
    void this.revealSelf();
    this.tabOverview?.open();
  }

  switchToAdjacentTab(delta: 1 | -1): void {
    const tabId = this.tabManager?.getAdjacentTabId(delta);
    if (tabId) this.activateTabAndFocusComposer(tabId);
  }

  /** 1-based, as on the badges. */
  switchToTabNumber(position: number): void {
    const tabId = this.tabManager?.getTabIdAt(position);
    if (tabId) this.activateTabAndFocusComposer(tabId);
  }

  private revealSelf(): Promise<void> {
    return revealWorkspaceLeaf(this.app.workspace, this.leaf).catch(() => {
      // Revealing is a courtesy; the switch below still happens.
    });
  }

  /** Keyboard switches land in the composer so the user can type at once. */
  private activateTabAndFocusComposer(tabId: TabId): void {
    const tabManager = this.tabManager;
    if (!tabManager) return;
    void this.revealSelf();
    void tabManager.switchToTab(tabId)
      .then(() => tabManager.getActiveTab()?.dom.inputEl.focus())
      .catch(() => new Notice('Tab-Wechsel fehlgeschlagen.'));
  }
}
