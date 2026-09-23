import { Menu, Notice, Platform, setIcon } from 'obsidian';

import { perfMark, perfSince } from '../../../core/diagnostics/perfLog';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import type { TitleGenerationService } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type { ChatRewindMode } from '../../../core/runtime/types';
import type { Conversation, ConversationMeta } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { setDraftIcon } from '../../../shared/draftIcon';
import { createProviderIconSvg } from '../../../shared/icons';
import { confirm } from '../../../shared/modals/ConfirmModal';
import { extractUserDisplayContent } from '../../../utils/context';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { cleanupThinkingBlock } from '../rendering/ThinkingBlockRenderer';
import { scheduleTranscriptSkeleton } from '../rendering/transcriptSkeleton';
import { renderWelcomeContent } from '../rendering/welcome';
import { findRewindContext } from '../rewind';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';
import { groupConversationsByRecency } from '../ui/historyGrouping';
import {
  countHistoryFilters,
  type HistoryFilter,
  type HistoryFilterCounts,
  type HistoryHit,
  type HistorySearchEntry,
  searchHistory,
} from '../ui/historySearch';
import type { ImageContextManager } from '../ui/ImageContext';
import type { ExternalContextSelector, McpServerSelector } from '../ui/InputToolbar';
import type { StatusPanel } from '../ui/StatusPanel';

function runConversationAction(action: () => Promise<void>, failureMessage: string): void {
  void action().catch(() => {
    new Notice(failureMessage);
  });
}

export interface ConversationCallbacks {
  onNewConversation?: () => void;
  onConversationLoaded?: () => void;
  onConversationSwitched?: () => void;
}

export interface ConversationControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getHistoryDropdown: () => HTMLElement | null;
  getWelcomeEl: () => HTMLElement | null;
  setWelcomeEl: (el: HTMLElement | null) => void;
  getMessagesEl: () => HTMLElement;
  getInputEl: () => HTMLTextAreaElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => ExternalContextSelector | null;
  clearQueuedMessage: () => void;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getAgentService?: () => ChatRuntime | null;
  ensureServiceForConversation?: (conversation: Conversation | null) => Promise<void>;
  dismissPendingInlinePrompts?: () => void;
}

type SaveOptions = {
  resumeAtMessageId?: string;
};

export type HistoryConversationOpenState = 'closed' | 'open' | 'current';

/** A history row: the searchable fields plus the conversation it renders. */
type HistoryRow = HistorySearchEntry & { conv: ConversationMeta };

/** Rows rendered per page; more on request keeps a 470-chat history responsive. */
const HISTORY_PAGE_SIZE = 80;

type HistoryRenderOptions = {
  onSelectConversation: (id: string) => Promise<void>;
  onOpenConversationInNewTab?: (id: string, activate?: boolean) => Promise<void>;
  getConversationOpenState?: (id: string) => HistoryConversationOpenState;
  onRerender: () => void;
};

export class ConversationController {
  private deps: ConversationControllerDeps;
  private callbacks: ConversationCallbacks;
  /** Serializes vault writes so fast UI events cannot persist stale state out of order. */
  private saveQueue: Promise<void> | null = null;
  /** Live history search query — persists across re-renders so typing keeps focus. */
  private historyFilter = '';
  /** Selected filter chip; kept while the history is re-rendered. */
  private historyScope: HistoryFilter = 'all';

  constructor(deps: ConversationControllerDeps, callbacks: ConversationCallbacks = {}) {
    this.deps = deps;
    this.callbacks = callbacks;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  // ============================================
  // Conversation Lifecycle
  // ============================================

  /**
   * Resets to entry point state (New Chat).
   *
   * Entry point is a blank UI state - no conversation is created until the
   * first message is sent. This prevents empty conversations cluttering history.
   */
  async createNew(options: { force?: boolean } = {}): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;
    const force = !!options.force;
    if (state.isStreaming && !force) return;
    if (state.isCreatingConversation) return;
    if (state.isSwitchingConversation) return;

    // Set flag to block message sending during reset
    state.isCreatingConversation = true;

    try {
      this.deps.dismissPendingInlinePrompts?.();

      if (force && state.isStreaming) {
        state.cancelRequested = true;
        state.bumpStreamGeneration();
        this.getAgentService()?.cancel();
      }

      // Save current conversation if it has messages
      if (state.currentConversationId && state.messages.length > 0) {
        await this.save();
      }

      subagentManager.orphanAllActive();
      subagentManager.clear();

      // Clear streaming state and related DOM references
      cleanupThinkingBlock(state.currentThinkingState);
      state.currentContentEl = null;
      state.currentTextEl = null;
      state.currentTextContent = '';
      state.currentThinkingState = null;
      state.toolCallElements.clear();
      state.writeEditStates.clear();
      state.isStreaming = false;

      // Reset to entry point state - no conversation created yet
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingConversationSave = false;

      // Reset agent service session (no session ID for entry point)
      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncConversationState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.empty();

      // Recreate welcome element first (before StatusPanel for consistent ordering)
      const welcomeEl = messagesEl.createDiv({ cls: 'claudian-welcome' });
      renderWelcomeContent(welcomeEl, this.getGreeting(), this.deps.plugin);
      this.deps.setWelcomeEl(welcomeEl);

      // Remount StatusPanel to restore state for new conversation
      this.deps.getStatusPanel()?.remount();

      this.deps.getInputEl().value = '';

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      this.deps.getImageContextManager()?.clearImages();
      this.deps.getMcpServerSelector()?.clearEnabled();
      // Pass current settings to ensure we have the most up-to-date persistent paths
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
      this.deps.clearQueuedMessage();

      this.callbacks.onNewConversation?.();
    } finally {
      state.isCreatingConversation = false;
    }
  }

  /**
   * Loads the current tab conversation, or starts at entry point if none.
   *
   * Entry point (no conversation) shows welcome screen without
   * creating a conversation. Conversation is created lazily on first message.
   */
  async loadActive(): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const conversationId = state.currentConversationId;
    const conversation = conversationId ? await plugin.getConversationById(conversationId) : null;

    // No active conversation - start at entry point
    if (!conversation) {
      state.currentConversationId = null;
      state.clearMessages();
      state.usage = null;
      state.currentTodos = null;
      state.pendingNewSessionPlan = null;
      state.planFilePath = null;
      state.prePlanPermissionMode = null;
      state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
      state.hasPendingConversationSave = false;

      // Pass persistent paths to prevent stale external contexts
      this.getAgentService()?.syncConversationState(
        null,
        plugin.settings.persistentExternalContextPaths || []
      );

      const fileCtx = this.deps.getFileContextManager();
      fileCtx?.resetForNewConversation();
      fileCtx?.autoAttachActiveFile();

      // Initialize external contexts with persistent paths from settings
      this.deps.getExternalContextSelector()?.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );

      this.deps.getMcpServerSelector()?.clearEnabled();

      const welcomeEl = renderer.renderMessages(
        [],
        () => this.getGreeting()
      );
      this.deps.setWelcomeEl(welcomeEl);
      this.updateWelcomeVisibility();

      // Clear any compose-only images; restart must not re-paste old images.
      void this.deps.getImageContextManager()?.reloadForConversation();

      this.callbacks.onConversationLoaded?.();
      return;
    }

    await this.deps.ensureServiceForConversation?.(conversation);
    this.restoreConversation(conversation, { autoAttachFile: true });
    this.updateWelcomeVisibility();

    this.callbacks.onConversationLoaded?.();
  }

  /** Switches to a different conversation. */
  async switchTo(id: string): Promise<void> {
    const { plugin, state, subagentManager } = this.deps;

    if (id === state.currentConversationId) return;
    if (state.isStreaming) return;
    if (state.isSwitchingConversation) return;
    if (state.isCreatingConversation) return;

    state.isSwitchingConversation = true;
    // First load of a long chat reads it from disk; show that it is loading.
    const finishSkeleton = state.messages.length === 0
      ? scheduleTranscriptSkeleton(this.deps.getMessagesEl())
      : null;

    try {
      this.deps.dismissPendingInlinePrompts?.();
      await this.save();

      // Validate the switch BEFORE wiping the current conversation's subagents.
      // switchConversation returns null when the target no longer exists (e.g.
      // deleted in another tab); orphaning/clearing first would destroy the
      // still-visible current conversation's swarm state for a switch that never
      // happens.
      const loadStart = perfMark();
      const conversation = await plugin.switchConversation(id);
      if (!conversation) {
        return;
      }
      perfSince(loadStart, 'conversation-load', `${conversation.messages.length} messages`);

      subagentManager.orphanAllActive();
      subagentManager.clear();

      await this.deps.ensureServiceForConversation?.(conversation);

      this.deps.getInputEl().value = '';
      this.deps.clearQueuedMessage();

      const renderStart = perfMark();
      this.restoreConversation(conversation);
      perfSince(renderStart, 'conversation-render', `${conversation.messages.length} messages`);

      this.deps.getHistoryDropdown()?.removeClass('visible');
      this.updateWelcomeVisibility();

      this.callbacks.onConversationSwitched?.();
    } finally {
      finishSkeleton?.();
      state.isSwitchingConversation = false;
    }
  }

  async rewind(
    userMessageId: string,
    mode: ChatRewindMode = 'code-and-conversation',
  ): Promise<void> {
    const { plugin, state, renderer } = this.deps;

    const agentServiceForCheck = this.getAgentService();
    if (agentServiceForCheck && !agentServiceForCheck.getCapabilities().supportsRewind) {
      new Notice(t('chat.rewind.failed', { error: 'Zurücksetzen wird von diesem Anbieter nicht unterstützt.' }));
      return;
    }

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const msgs = state.messages;
    const userIdx = msgs.findIndex(m => m.id === userMessageId);
    if (userIdx === -1) {
      new Notice(t('chat.rewind.failed', { error: 'Nachricht nicht gefunden' }));
      return;
    }
    const userMsg = msgs[userIdx];
    if (!userMsg.userMessageId) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }

    const rewindCtx = findRewindContext(msgs, userIdx);
    if (!rewindCtx.hasResponse || !rewindCtx.prevAssistantUuid) {
      new Notice(t('chat.rewind.unavailableNoUuid'));
      return;
    }
    const prevAssistantUuid = rewindCtx.prevAssistantUuid;

    const confirmed = await confirm(
      plugin.app,
      mode === 'conversation'
        ? t('chat.rewind.confirmMessageConversationOnly')
        : t('chat.rewind.confirmMessage'),
      t('chat.rewind.confirmButton')
    );
    if (!confirmed) return;

    if (state.isStreaming) {
      new Notice(t('chat.rewind.unavailableStreaming'));
      return;
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice(t('chat.rewind.failed', { error: 'Agentendienst nicht verfügbar' }));
      return;
    }

    let result;
    try {
      result = await agentService.rewind(userMsg.userMessageId, prevAssistantUuid, mode);
    } catch (e) {
      new Notice(t('chat.rewind.failed', { error: e instanceof Error ? e.message : 'Unbekannter Fehler' }));
      return;
    }
    if (!result.canRewind) {
      new Notice(t('chat.rewind.cannot', { error: result.error ?? 'Unbekannter Fehler' }));
      return;
    }

    state.truncateAt(userMessageId);

    const inputEl = this.deps.getInputEl();
    inputEl.value = userMsg.content;
    inputEl.focus();

    const welcomeEl = renderer.renderMessages(state.messages, () => this.getGreeting());
    this.deps.setWelcomeEl(welcomeEl);
    this.updateWelcomeVisibility();

    const filesChanged = result.filesChanged?.length ?? 0;
    let saveError: string | null = null;
    try {
      await this.save(false, { resumeAtMessageId: prevAssistantUuid });
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Speichern fehlgeschlagen';
    }

    if (saveError) {
      new Notice(
        mode === 'conversation'
          ? t('chat.rewind.noticeConversationOnlySaveFailed', { error: saveError })
          : t('chat.rewind.noticeSaveFailed', { count: String(filesChanged), error: saveError })
      );
      return;
    }

    new Notice(
      mode === 'conversation'
        ? t('chat.rewind.noticeConversationOnly')
        : t('chat.rewind.notice', { count: String(filesChanged) })
    );
  }

  /**
   * Saves the current conversation.
   *
   * If we're at an entry point (no conversation yet) and have messages,
   * creates a new conversation first (lazy creation).
   *
   * For native sessions (new conversations with sessionId from SDK),
   * only metadata is saved - the SDK handles message persistence.
   */
  save(updateLastResponse = false, options?: SaveOptions): Promise<void> {
    // Start the first write synchronously. This keeps click handlers responsive;
    // only genuinely overlapping writes wait for the active operation.
    const operation = this.saveQueue
      ? this.saveQueue.then(() => this.performSave(updateLastResponse, options))
      : this.performSave(updateLastResponse, options);
    const queueTail = operation
      .catch(() => undefined)
      .finally(() => {
        if (this.saveQueue === queueTail) this.saveQueue = null;
      });
    // A failed write rejects its own caller but never poisons later saves.
    this.saveQueue = queueTail;
    return operation;
  }

  private async performSave(updateLastResponse = false, options?: SaveOptions): Promise<void> {
    const { plugin, state } = this.deps;

    // Entry point with no messages - nothing to save
    if (!state.currentConversationId && state.messages.length === 0) {
      return;
    }

    const agentService = this.getAgentService();
    const sessionInvalidated = agentService?.consumeSessionInvalidation?.() ?? false;

    // Entry point with messages - create conversation lazily
    // New conversations always use SDK-native storage.
    if (!state.currentConversationId && state.messages.length > 0) {
      const initialSessionId = agentService?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: agentService?.providerId,
        sessionId: initialSessionId,
      });
      state.currentConversationId = conversation.id;
      // Re-tag any unsent draft images from the null "new chat" scope to this
      // freshly created conversation so they stay bound to the right chat.
      this.deps.getImageContextManager()?.reassignToConversation(conversation.id);
    }

    const fileCtx = this.deps.getFileContextManager();
    const currentNote = fileCtx?.getCurrentNotePath() || undefined;
    const externalContextSelector = this.deps.getExternalContextSelector();
    const externalContextPaths = externalContextSelector?.getExternalContexts() ?? [];
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const enabledMcpServers = mcpServerSelector ? Array.from(mcpServerSelector.getEnabledServers()) : [];

    const conversation = plugin.getConversationSync(state.currentConversationId!);

    const { updates: sessionUpdates } = agentService
      ? agentService.buildSessionUpdates({ conversation, sessionInvalidated })
      : { updates: {} };

    const updates: Partial<Conversation> = {
      ...sessionUpdates,
      messages: state.messages,
      currentNote: currentNote,
      externalContextPaths: externalContextPaths.length > 0 ? externalContextPaths : undefined,
      usage: state.usage ?? undefined,
      enabledMcpServers: enabledMcpServers.length > 0 ? enabledMcpServers : undefined,
    };

    if (updateLastResponse) {
      updates.lastResponseAt = Date.now();
    }

    if (options) {
      updates.resumeAtMessageId = options.resumeAtMessageId;
    }

    await plugin.updateConversation(state.currentConversationId!, updates);
    state.hasPendingConversationSave = false;
  }

  /**
   * Shared logic for restoring a conversation into the current tab.
   * Used by both loadActive() and switchTo() to avoid duplication.
   */
  private restoreConversation(
    conversation: Conversation,
    options?: { autoAttachFile?: boolean }
  ): void {
    const { plugin, state, renderer } = this.deps;

    state.currentConversationId = conversation.id;
    state.messages = [...conversation.messages];
    state.usage = conversation.usage ?? null;
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true;
    state.hasPendingConversationSave = false;

    // Clear status panels (auto-hide: panels reappear when agent creates new todos)
    state.currentTodos = null;

    const hasMessages = state.messages.length > 0;

    // Determine external context paths for this session
    // Empty session: use persistent paths; session with messages: use saved paths
    const externalContextPaths = hasMessages
      ? conversation.externalContextPaths || []
      : plugin.settings.persistentExternalContextPaths || [];

    this.getAgentService()?.syncConversationState(conversation, externalContextPaths);

    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForLoadedConversation(hasMessages);

    if (conversation.currentNote) {
      fileCtx?.setCurrentNote(conversation.currentNote);
    } else if (!hasMessages && options?.autoAttachFile) {
      fileCtx?.autoAttachActiveFile();
    }

    this.restoreExternalContextPaths(conversation.externalContextPaths, !hasMessages);

    const mcpServerSelector = this.deps.getMcpServerSelector();
    if (conversation.enabledMcpServers && conversation.enabledMcpServers.length > 0) {
      mcpServerSelector?.setEnabledServers(conversation.enabledMcpServers);
    } else {
      mcpServerSelector?.clearEnabled();
    }

    // Brand-color fallback for legacy messages without `agentProvider`.
    renderer.setFallbackProvider?.(conversation.providerId);

    const welcomeEl = renderer.renderMessages(
      state.messages,
      () => this.getGreeting()
    );
    this.deps.setWelcomeEl(welcomeEl);

    // Clear compose-only images when changing chats. Sent images render from the
    // message archive instead of being reinserted into the input.
    void this.deps.getImageContextManager()?.reloadForConversation();
  }

  /**
   * Restores external context paths based on session state.
   * New or empty sessions get current persistent paths from settings.
   * Sessions with messages restore exactly what was saved.
   */
  private restoreExternalContextPaths(
    savedPaths: string[] | undefined,
    isEmptySession: boolean
  ): void {
    const { plugin } = this.deps;
    const externalContextSelector = this.deps.getExternalContextSelector();
    if (!externalContextSelector) {
      return;
    }

    if (isEmptySession) {
      // Empty session: use current persistent paths from settings
      externalContextSelector.clearExternalContexts(
        plugin.settings.persistentExternalContextPaths || []
      );
    } else {
      // Session with messages: restore exactly what was saved
      externalContextSelector.setExternalContexts(savedPaths || []);
    }
  }

  // ============================================
  // History Dropdown
  // ============================================

  toggleHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    const isVisible = dropdown.hasClass('visible');
    if (isVisible) {
      dropdown.removeClass('visible');
    } else {
      this.updateHistoryDropdown();
      dropdown.addClass('visible');
    }
  }

  updateHistoryDropdown(): void {
    const dropdown = this.deps.getHistoryDropdown();
    if (!dropdown) return;

    this.renderHistoryItems(dropdown, {
      onSelectConversation: (id) => this.switchTo(id),
      onRerender: () => this.updateHistoryDropdown(),
    });
  }

  /**
   * Renders the history into a container (the dropdown and the sidebar share it).
   *
   * Header: title, count, one search field and filter chips. List: recency
   * groups, or relevance order while searching, rendered a page at a time so
   * 470+ chats stay responsive. ↑/↓ move between rows, Enter in the search
   * opens the top hit, ⌘/Ctrl+Enter opens in a new tab, Esc clears the search.
   */
  private renderHistoryItems(
    container: HTMLElement,
    options: HistoryRenderOptions
  ): void {
    const { plugin } = this.deps;

    container.empty();

    const rows = this.buildHistoryRows(plugin.getConversationList());
    const counts = countHistoryFilters(rows);
    if (!this.isHistoryScopeAvailable(this.historyScope, counts)) {
      this.historyScope = 'all';
    }

    const dropdownHeader = container.createDiv({ cls: 'claudian-history-header' });
    const headerTop = dropdownHeader.createDiv({ cls: 'claudian-history-header-top' });
    headerTop.createSpan({ cls: 'claudian-history-header-title', text: 'Verlauf' });
    const countEl = headerTop.createSpan({ cls: 'claudian-history-header-count' });

    const searchWrap = dropdownHeader.createDiv({ cls: 'claudian-history-search' });
    const searchIcon = searchWrap.createSpan({ cls: 'claudian-history-search-icon' });
    setIcon(searchIcon, 'search');
    const searchInput = searchWrap.createEl('input', {
      cls: 'claudian-history-search-input',
      attr: {
        type: 'text',
        placeholder: 'Titel, Inhalte oder Anbieter suchen …',
        spellcheck: 'false',
        autocomplete: 'off',
        'aria-label': 'Verlauf durchsuchen',
      },
    });
    searchInput.value = this.historyFilter;
    const clearBtn = searchWrap.createEl('button', {
      cls: 'claudian-history-search-clear',
      attr: { type: 'button', 'aria-label': 'Suche zurücksetzen' },
    });
    setIcon(clearBtn, 'x');

    const filterBar = dropdownHeader.createDiv({
      cls: 'claudian-history-filters',
      attr: { role: 'toolbar', 'aria-label': 'Verlauf filtern' },
    });

    const list = container.createDiv({ cls: 'claudian-history-list' });

    const footer = container.createDiv({ cls: 'claudian-history-footer', attr: { 'aria-hidden': 'true' } });
    const modifier = Platform.isMacOS ? '⌘' : 'Strg';
    for (const [keys, label] of [['↑↓', 'Auswählen'], ['↵', 'Öffnen'], [`${modifier} ↵`, 'Neuer Tab'], ['Esc', 'Suche leeren']] as const) {
      const hint = footer.createSpan({ cls: 'claudian-history-footer-hint' });
      hint.createEl('kbd', { text: keys });
      hint.appendText(label);
    }

    let visibleLimit = HISTORY_PAGE_SIZE;
    let hits: Array<HistoryHit<HistoryRow>> = [];

    const openHit = (hit: HistoryHit<HistoryRow> | undefined, inNewTab: boolean): void => {
      if (!hit || hit.entry.id === this.deps.state.currentConversationId) return;
      const open = inNewTab && options.onOpenConversationInNewTab
        ? () => options.onOpenConversationInNewTab?.(hit.entry.id, true)
        : () => options.onSelectConversation(hit.entry.id);
      runConversationAction(
        () => this.runHistoryAction(open, 'Unterhaltung konnte nicht geladen werden.'),
        'Unterhaltung konnte nicht geladen werden.',
      );
    };

    const rowButtons = (): HTMLButtonElement[] => Array.from(
      list.querySelectorAll<HTMLButtonElement>('.claudian-history-item-content'),
    ).filter((button) => !button.disabled);

    const renderFilters = (): void => {
      filterBar.empty();
      const chips: Array<{ scope: HistoryFilter; label: string; count: number; providerId?: string }> = [
        { scope: 'all', label: 'Alle', count: counts.all },
      ];
      if (counts.pinned > 0) chips.push({ scope: 'pinned', label: 'Angepinnt', count: counts.pinned });
      if (counts.drafts > 0) chips.push({ scope: 'drafts', label: 'Entwürfe', count: counts.drafts });
      if (counts.providers.length > 1) {
        for (const provider of counts.providers) {
          chips.push({
            scope: `provider:${provider.providerId}`,
            label: provider.label,
            count: provider.count,
            providerId: provider.providerId,
          });
        }
      }
      filterBar.toggleClass('claudian-hidden', chips.length < 2);
      for (const chip of chips) {
        const pressed = this.historyScope === chip.scope;
        const chipEl = filterBar.createEl('button', {
          cls: `claudian-history-filter${pressed ? ' is-active' : ''}`,
          attr: {
            type: 'button',
            'aria-pressed': pressed ? 'true' : 'false',
            ...(chip.providerId ? { 'data-provider': chip.providerId } : {}),
          },
        });
        if (chip.scope === 'drafts') {
          setDraftIcon(chipEl.createSpan({ cls: 'claudian-history-filter-icon', attr: { 'aria-hidden': 'true' } }));
        } else if (chip.providerId) {
          const icon = ProviderRegistry.getProviderRegistrationSafe(chip.providerId)?.chatUIConfig?.getProviderIcon?.();
          if (icon) {
            const iconEl = chipEl.createSpan({ cls: 'claudian-history-filter-icon', attr: { 'aria-hidden': 'true' } });
            iconEl.appendChild(createProviderIconSvg(icon, {
              width: 12,
              height: 12,
              dataProvider: chip.providerId,
              ownerDocument: filterBar.ownerDocument,
            }));
          }
        }
        chipEl.createSpan({ cls: 'claudian-history-filter-label', text: chip.label });
        chipEl.createSpan({ cls: 'claudian-history-filter-count', text: String(chip.count) });
        chipEl.addEventListener('click', () => {
          this.historyScope = chip.scope;
          visibleLimit = HISTORY_PAGE_SIZE;
          renderFilters();
          renderList();
        });
      }
    };

    const renderList = (): void => {
      list.empty();
      const query = this.historyFilter.trim();
      clearBtn.toggleClass('claudian-hidden', query.length === 0);

      if (rows.length === 0) {
        const empty = list.createDiv({ cls: 'claudian-history-empty' });
        empty.createDiv({ cls: 'claudian-history-empty-title', text: 'Noch keine Unterhaltungen' });
        empty.createDiv({
          cls: 'claudian-history-empty-hint',
          text: 'Jeder Chat landet hier und ist über Titel, Inhalte und Anbieter durchsuchbar.',
        });
        countEl.setText('');
        return;
      }

      hits = searchHistory(rows, query, this.historyScope);
      countEl.setText(hits.length === rows.length ? `${rows.length}` : `${hits.length} von ${rows.length}`);

      if (hits.length === 0) {
        const empty = list.createDiv({ cls: 'claudian-history-empty' });
        empty.createDiv({
          cls: 'claudian-history-empty-title',
          text: query ? `Keine Treffer für „${query}“` : 'In diesem Filter ist nichts',
        });
        empty.createDiv({
          cls: 'claudian-history-empty-hint',
          text: 'Gesucht wird in Titeln, Prompts, Antwortanfängen, Tags und Anbietern.',
        });
        if (this.historyScope !== 'all') {
          const reset = empty.createEl('button', {
            cls: 'claudian-history-empty-reset',
            text: 'Alle Unterhaltungen durchsuchen',
            attr: { type: 'button' },
          });
          reset.addEventListener('click', () => {
            this.historyScope = 'all';
            renderFilters();
            renderList();
          });
        }
        return;
      }

      const shown = hits.slice(0, visibleLimit);
      if (query) {
        // Relevance order: recency groups would scatter the best matches.
        for (const hit of shown) this.renderHistoryRow(list, hit, options);
      } else {
        const groups = groupConversationsByRecency(
          shown,
          (hit) => hit.entry.conv.lastResponseAt ?? hit.entry.conv.createdAt,
          (hit) => hit.entry.pinned,
        );
        const showHeaders = groups.length > 1;
        for (const group of groups) {
          if (showHeaders) {
            list.createDiv({ cls: 'claudian-history-group', text: group.label });
          }
          for (const hit of group.items) this.renderHistoryRow(list, hit, options);
        }
      }

      const remaining = hits.length - shown.length;
      if (remaining > 0) {
        const more = list.createEl('button', {
          cls: 'claudian-history-more-results',
          text: `${Math.min(remaining, HISTORY_PAGE_SIZE)} weitere anzeigen · ${remaining} übrig`,
          attr: { type: 'button' },
        });
        more.addEventListener('click', () => {
          visibleLimit += HISTORY_PAGE_SIZE;
          renderList();
        });
      }
    };

    searchInput.addEventListener('input', () => {
      this.historyFilter = searchInput.value;
      visibleLimit = HISTORY_PAGE_SIZE;
      renderList();
    });
    searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && this.historyFilter) {
        event.preventDefault();
        event.stopPropagation();
        this.historyFilter = '';
        searchInput.value = '';
        renderList();
      } else if (event.key === 'ArrowDown') {
        const first = rowButtons()[0];
        if (first) {
          event.preventDefault();
          first.focus();
        }
      } else if (event.key === 'Enter' && this.historyFilter.trim()) {
        // Type, then Enter: open the best match without reaching for the mouse.
        event.preventDefault();
        openHit(hits.find((hit) => hit.entry.id !== this.deps.state.currentConversationId), event.metaKey || event.ctrlKey);
      }
    });
    clearBtn.addEventListener('click', () => {
      this.historyFilter = '';
      searchInput.value = '';
      searchInput.focus();
      renderList();
    });

    list.addEventListener('keydown', (event: KeyboardEvent) => {
      const target = event.target as HTMLButtonElement | null;
      if (!target?.hasClass?.('claudian-history-item-content')) return;
      const buttons = rowButtons();
      const index = buttons.indexOf(target);
      if (index < 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        buttons[Math.min(index + 1, buttons.length - 1)]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        (index === 0 ? searchInput : buttons[index - 1]).focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        buttons[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        buttons[buttons.length - 1]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        searchInput.focus();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openHit(hits.find((hit) => hit.entry.id === target.dataset?.conversationId), true);
      }
    });

    renderFilters();
    renderList();
  }

  /** History rows in display order: pinned first, then most recent activity. */
  private buildHistoryRows(conversations: ConversationMeta[]): HistoryRow[] {
    const drafts = this.deps.plugin.composerDrafts;
    return [...conversations]
      .sort((a, b) => {
        const pinDelta = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
        if (pinDelta !== 0) return pinDelta;
        return (b.lastResponseAt ?? b.createdAt) - (a.lastResponseAt ?? a.createdAt);
      })
      .map((conv) => ({
        id: conv.id,
        title: conv.title,
        providerId: conv.providerId ?? '',
        providerLabel: ProviderRegistry.getProviderRegistrationSafe(conv.providerId)?.displayName ?? conv.providerId ?? '',
        tag: this.inferConversationTag(conv),
        preview: conv.preview ?? '',
        lastPrompt: conv.lastPrompt,
        text: conv.searchText,
        pinned: Boolean(conv.pinned),
        hasDraft: drafts?.hasConversationDraft(conv.id) ?? false,
        conv,
      }));
  }

  /** A remembered scope can vanish (last draft sent, last pin removed). */
  private isHistoryScopeAvailable(scope: HistoryFilter, counts: HistoryFilterCounts): boolean {
    if (scope === 'all') return true;
    if (scope === 'pinned') return counts.pinned > 0;
    if (scope === 'drafts') return counts.drafts > 0;
    const providerId = scope.slice('provider:'.length);
    return counts.providers.length > 1 && counts.providers.some((provider) => provider.providerId === providerId);
  }

  /** One history row: provider mark, title line, detail line, row actions. */
  private renderHistoryRow(
    list: HTMLElement,
    hit: HistoryHit<HistoryRow>,
    options: HistoryRenderOptions,
  ): void {
    const { state } = this.deps;
    const row = hit.entry;
    const conv = row.conv;
    const isCurrent = conv.id === state.currentConversationId;
    const item = list.createDiv({
      cls: `claudian-history-item${isCurrent ? ' active' : ''}`,
    });

    if (row.pinned) {
      item.addClass('is-pinned');
    }

    if (conv.providerId) {
      item.setAttribute('data-provider', conv.providerId);
    }

    const iconEl = item.createDiv({ cls: 'claudian-history-item-icon claudian-history-avatar' });
    const reg = ProviderRegistry.getProviderRegistrationSafe(conv.providerId);
    const providerIcon = reg?.chatUIConfig?.getProviderIcon?.();
    if (providerIcon) {
      const iconSvg = createProviderIconSvg(providerIcon, {
        width: 16,
        height: 16,
        className: 'claudian-history-avatar-icon',
        dataProvider: conv.providerId,
        ownerDocument: list.ownerDocument,
      });
      iconEl.appendChild(iconSvg);
    } else {
      setIcon(iconEl, isCurrent ? 'message-square-dot' : 'message-square');
    }
    iconEl.setAttribute('aria-hidden', 'true');

    const content = item.createEl('button', {
      cls: 'claudian-history-item-content',
      attr: {
        type: 'button',
        'aria-label': this.describeHistoryRow(row, isCurrent),
        'data-conversation-id': conv.id,
        ...(isCurrent ? { 'aria-current': 'true' } : {}),
      },
    });
    content.disabled = isCurrent;

    const headerRow = content.createDiv({ cls: 'claudian-history-item-header-row' });
    if (row.hasDraft) {
      item.addClass('has-draft');
      const draftEl = headerRow.createSpan({
        cls: 'claudian-history-item-draft',
        attr: { 'aria-hidden': 'true', title: 'Ungesendeter Entwurf' },
      });
      setDraftIcon(draftEl);
    }
    const titleEl = headerRow.createSpan({ cls: 'claudian-history-item-title', text: conv.title });
    titleEl.setAttribute('title', conv.title);

    if (row.pinned) {
      const pinMark = headerRow.createSpan({ cls: 'claudian-history-item-pin-mark', attr: { 'aria-hidden': 'true' } });
      setIcon(pinMark, 'pin');
    }

    if (row.tag) {
      headerRow.createSpan({ cls: 'claudian-history-item-tag', text: row.tag });
    }

    headerRow.createSpan({
      cls: 'claudian-history-item-date',
      text: isCurrent ? 'Aktuell' : this.formatDate(conv.lastResponseAt ?? conv.createdAt),
    });

    if (hit.snippet) {
      const snippetEl = content.createDiv({ cls: 'claudian-history-item-snippet is-match' });
      snippetEl.appendText(hit.snippet.before);
      snippetEl.createEl('mark', { cls: 'claudian-history-item-mark', text: hit.snippet.match });
      snippetEl.appendText(hit.snippet.after);
    } else {
      // The latest prompt says where the chat stopped; the title already names the topic.
      const detail = (row.lastPrompt || row.preview).trim();
      if (detail) {
        content.createDiv({ cls: 'claudian-history-item-snippet', text: detail });
      }
    }

    if (!isCurrent) {
      content.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isHistoryNewTabModifierClick(e) && options.onOpenConversationInNewTab) {
          e.preventDefault();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              'Unterhaltung konnte nicht geladen werden.',
            ),
            'Unterhaltung konnte nicht geladen werden.',
          );
          return;
        }

        runConversationAction(
          () => this.runHistoryAction(
            () => options.onSelectConversation(conv.id),
            'Unterhaltung konnte nicht geladen werden.',
          ),
          'Unterhaltung konnte nicht geladen werden.',
        );
      });

      if (options.onOpenConversationInNewTab) {
        content.addEventListener('auxclick', (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          runConversationAction(
            () => this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conv.id, true),
              'Unterhaltung konnte nicht geladen werden.',
            ),
            'Unterhaltung konnte nicht geladen werden.',
          );
        });
      }
    }

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showHistoryContextMenu(item, conv.id, conv.title, isCurrent, options, e);
    });

    const actions = item.createDiv({ cls: 'claudian-history-item-actions' });

    // Show regenerate button if title generation failed, or loading indicator if pending
    if (conv.titleGenerationStatus === 'pending') {
      const loadingEl = actions.createEl('span', { cls: 'claudian-action-btn claudian-action-loading' });
      setIcon(loadingEl, 'loader-2');
      loadingEl.setAttribute('aria-label', 'Titel wird erzeugt …');
      loadingEl.setAttribute('role', 'status');
      loadingEl.setAttribute('aria-live', 'polite');
    } else if (conv.titleGenerationStatus === 'failed') {
      const regenerateBtn = actions.createEl('button', {
        cls: 'claudian-action-btn',
        attr: { type: 'button' },
      });
      setIcon(regenerateBtn, 'refresh-cw');
      regenerateBtn.setAttribute('aria-label', 'Titel neu erzeugen');
      regenerateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        runConversationAction(
          () => this.regenerateTitle(conv.id),
          'Titel konnte nicht neu erzeugt werden.',
        );
      });
    }

    // Pinned rows sort to the top of the history.
    const pinBtn = actions.createEl('button', {
      cls: 'claudian-action-btn claudian-history-item-pin',
      attr: {
        type: 'button',
        'aria-label': row.pinned ? 'Chat loslösen' : 'Chat anpinnen',
        'aria-pressed': row.pinned ? 'true' : 'false',
      },
    });
    setIcon(pinBtn, row.pinned ? 'pin-off' : 'pin');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runConversationAction(async () => {
        await this.deps.plugin.updateConversation(conv.id, { pinned: !row.pinned });
        options.onRerender?.();
      }, 'Anpinnen fehlgeschlagen');
    });

    const renameBtn = actions.createEl('button', {
      cls: 'claudian-action-btn',
      attr: { type: 'button' },
    });
    setIcon(renameBtn, 'pencil');
    renameBtn.setAttribute('aria-label', 'Umbenennen');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRenameInput(item, conv.id, conv.title);
    });

    // Visible "save as note" action — discoverable without the context menu.
    const exportBtn = actions.createEl('button', {
      cls: 'claudian-action-btn',
      attr: { type: 'button' },
    });
    setIcon(exportBtn, 'download');
    exportBtn.setAttribute('aria-label', 'Als Notiz speichern');
    exportBtn.setAttribute('title', 'Als Notiz im Vault speichern');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.runHistoryAction(
        () => this.deps.plugin.exportActiveConversation(conv.id),
        'Konversation konnte nicht exportiert werden',
      );
    });

    const deleteBtn = actions.createEl('button', {
      cls: 'claudian-action-btn claudian-delete-btn',
      attr: { type: 'button' },
    });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', 'Löschen');
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runConversationAction(
        () => this.runHistoryAction(
          () => this.deleteHistoryConversation(conv.id, options),
          'Unterhaltung konnte nicht gelöscht werden.',
        ),
        'Unterhaltung konnte nicht gelöscht werden.',
      );
    });
  }

  /** Screen-reader label: state the eye gets from the pencil, pin and time. */
  private describeHistoryRow(row: HistoryRow, isCurrent: boolean): string {
    const parts = [row.title];
    if (isCurrent) parts.push('aktuelle Unterhaltung');
    if (row.pinned) parts.push('angepinnt');
    if (row.hasDraft) parts.push('mit ungesendetem Entwurf');
    if (row.providerLabel) parts.push(row.providerLabel);
    return parts.join(', ');
  }

  private inferConversationTag(conv: ConversationMeta): string | null {
    const text = `${conv.title} ${conv.preview ?? ''}`.toLowerCase();
    if (/firewall|fortinet|security|vpn|cert|auth|proxy|network/i.test(text)) return 'Firewall';
    if (/bug|fix|error|issue|problem|patch/i.test(text)) return 'Bugfix';
    if (/dev|code|script|component|test|refactor|ts|typescript|python/i.test(text)) return 'Entwicklung';
    if (/video|audio|media|image|animation|framer|css|design/i.test(text)) return 'UI & Design';
    if (/doc|readme|notiz|note|guide|doku/i.test(text)) return 'Notizen';
    return null;
  }

  private isHistoryNewTabModifierClick(event: MouseEvent): boolean {
    return !event.altKey && !event.shiftKey && (event.metaKey || event.ctrlKey);
  }

  private async runHistoryAction(
    action: () => Promise<void> | void,
    errorMessage: string,
  ): Promise<void> {
    try {
      await action();
    } catch {
      new Notice(errorMessage);
    }
  }

  private showHistoryContextMenu(
    item: HTMLElement,
    conversationId: string,
    title: string,
    isCurrent: boolean,
    options: HistoryRenderOptions,
    event: MouseEvent,
  ): void {
    const menu = new Menu();
    const openState = options.getConversationOpenState?.(conversationId) ?? (isCurrent ? 'current' : 'closed');

    if (!isCurrent) {
      if (openState === 'closed' && options.onOpenConversationInNewTab) {
        menu.addItem((menuItem) => menuItem
          .setTitle('In neuem Tab öffnen')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, true),
              'Unterhaltung konnte nicht geladen werden.',
            );
          }));
        menu.addItem((menuItem) => menuItem
          .setTitle('Im Hintergrund-Tab öffnen')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onOpenConversationInNewTab?.(conversationId, false),
              'Unterhaltung konnte nicht geladen werden.',
            );
          }));
      } else if (openState === 'open') {
        menu.addItem((menuItem) => menuItem
          .setTitle('Zum geöffneten Tab wechseln')
          .onClick(() => {
            void this.runHistoryAction(
              () => options.onSelectConversation(conversationId),
              'Unterhaltung konnte nicht geladen werden.',
            );
          }));
      }
    }

    menu.addItem((menuItem) => menuItem
      .setTitle('Umbenennen')
      .onClick(() => {
        this.showRenameInput(item, conversationId, title);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle('Als Notiz exportieren')
      .setIcon('download')
      .onClick(() => {
        void this.deps.plugin.exportActiveConversation(conversationId);
      }));
    menu.addItem((menuItem) => menuItem
      .setTitle('Löschen')
      .onClick(() => {
        void this.runHistoryAction(
          () => this.deleteHistoryConversation(conversationId, options),
          'Unterhaltung konnte nicht gelöscht werden.',
        );
      }));

    menu.showAtMouseEvent(event);
  }

  private async deleteHistoryConversation(
    conversationId: string,
    options: HistoryRenderOptions,
  ): Promise<void> {
    const { plugin, state } = this.deps;
    if (state.isStreaming) return;

    await plugin.deleteConversation(conversationId);
    options.onRerender();

    if (conversationId === state.currentConversationId) {
      await this.loadActive();
    }
  }

  /** Shows inline rename input for a conversation. */
  private showRenameInput(item: HTMLElement, convId: string, currentTitle: string): void {
    const titleEl = item.querySelector('.claudian-history-item-title') as HTMLElement;
    if (!titleEl) return;

    const input = (item.ownerDocument ?? window.document).createElement('input');
    input.type = 'text';
    input.className = 'claudian-rename-input';
    input.value = currentTitle;
    input.setAttribute('aria-label', 'Unterhaltung umbenennen');

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const finishRename = async () => {
      try {
        const newTitle = input.value.trim() || currentTitle;
        await this.deps.plugin.renameConversation(convId, newTitle);
        this.updateHistoryDropdown();
      } catch {
        new Notice('Unterhaltung konnte nicht umbenannt werden.');
      }
    };

    input.addEventListener('blur', () => {
      runConversationAction(finishRename, 'Unterhaltung konnte nicht umbenannt werden.');
    });
    input.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.isComposing) {
        input.blur();
      } else if (e.key === 'Escape' && !e.isComposing) {
        input.value = currentTitle;
        input.blur();
      }
    });
  }

  // ============================================
  // Welcome & Greeting
  // ============================================

  /** Generates a dynamic greeting based on time/day. */
  getGreeting(): string {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const name = this.deps.plugin.settings.userName?.trim();

    // Helper to optionally personalize a greeting (with fallback for no-name case)
    const personalize = (base: string, noNameFallback?: string): string =>
      name ? `${base}, ${name}` : (noNameFallback ?? base);

    // Day-specific greetings (some personalized, some universal)
    const dayGreetings: Record<number, string[]> = {
      0: [personalize('Schönen Sonntag'), 'Sonntagsrunde?', 'Willkommen im Wochenende'],
      1: [personalize('Schönen Montag'), personalize('Los geht’s', 'Los geht’s!')],
      2: [personalize('Schönen Dienstag')],
      3: [personalize('Schönen Mittwoch')],
      4: [personalize('Schönen Donnerstag')],
      5: [personalize('Schönen Freitag'), personalize('Freitagsgefühl')],
      6: [personalize('Schönen Samstag', 'Schönen Samstag!'), personalize('Willkommen im Wochenende')],
    };

    // Time-specific greetings
    const getTimeGreetings = (): string[] => {
      if (hour >= 5 && hour < 12) {
        return [personalize('Guten Morgen'), 'Kaffee und Claudian?'];
      } else if (hour >= 12 && hour < 18) {
        return [personalize('Guten Tag'), personalize('Hallo'), personalize('Wie geht’s') + '?'];
      } else if (hour >= 18 && hour < 22) {
        return [personalize('Guten Abend'), personalize('Abend'), personalize('Wie war dein Tag') + '?'];
      } else {
        return ['Hallo, Nachteule', personalize('Guten Abend')];
      }
    };

    // General greetings
    const generalGreetings = [
      personalize('Hallo'),
      name ? `Hi ${name}, wie geht’s?` : 'Hi, wie geht’s?',
      personalize('Wie läuft’s') + '?',
      personalize('Willkommen zurück') + '!',
      personalize('Was gibt’s Neues') + '?',
      ...(name ? [`${name} ist wieder da!`] : []),
      'Du hast absolut recht!',
    ];

    // Combine day + time + general greetings, pick randomly
    const allGreetings = [
      ...(dayGreetings[day] || []),
      ...getTimeGreetings(),
      ...generalGreetings,
    ];

    return allGreetings[Math.floor(Math.random() * allGreetings.length)];
  }

  /** Updates welcome element visibility based on message count. */
  updateWelcomeVisibility(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    if (this.deps.state.messages.length === 0) {
      welcomeEl.removeClass('claudian-hidden');
    } else {
      welcomeEl.addClass('claudian-hidden');
    }
  }

  /**
   * Initializes the welcome greeting for a new tab without a conversation.
   * Called when a new tab is activated and has no conversation loaded.
   */
  initializeWelcome(): void {
    const welcomeEl = this.deps.getWelcomeEl();
    if (!welcomeEl) return;

    // Initialize file context to auto-attach the currently focused note
    const fileCtx = this.deps.getFileContextManager();
    fileCtx?.resetForNewConversation();
    fileCtx?.autoAttachActiveFile();

    // Only add greeting if not already present
    if (!welcomeEl.querySelector('.claudian-welcome-greeting')) {
      renderWelcomeContent(welcomeEl, this.getGreeting(), this.deps.plugin);
    }

    this.updateWelcomeVisibility();
  }

  // ============================================
  // Utilities
  // ============================================

  /** Generates a fallback title from the first message (used when AI fails). */
  generateFallbackTitle(firstMessage: string): string {
    const firstSentence = firstMessage.split(/[.!?\n]/)[0].trim();
    const autoTitle = firstSentence.substring(0, 50);
    const suffix = firstSentence.length > 50 ? '...' : '';
    return `${autoTitle}${suffix}`;
  }

  /** Regenerates AI title for a conversation. */
  async regenerateTitle(conversationId: string): Promise<void> {
    const { plugin } = this.deps;
    if (!plugin.settings.enableAutoTitleGeneration) return;

    // Title generation is delegated to the active provider service
    const fullConv = await plugin.getConversationById(conversationId);
    if (!fullConv || fullConv.messages.length < 1) return;

    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) return;

    // Find first user message by role (not by index)
    const firstUserMsg = fullConv.messages.find(m => m.role === 'user');
    if (!firstUserMsg) return;

    const userContent = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;

    // Store current title to check if user renames during generation
    const expectedTitle = fullConv.title;

    // Set pending status before starting generation
    await plugin.updateConversation(conversationId, { titleGenerationStatus: 'pending' });
    this.updateHistoryDropdown();

    // Fire async AI title generation
    await titleService.generateTitle(
      conversationId,
      userContent,
      async (convId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(convId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches expected)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(convId, result.title);
          await plugin.updateConversation(convId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep existing title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(convId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(convId, { titleGenerationStatus: undefined });
        }
        this.updateHistoryDropdown();
      }
    );
  }

  /** Formats a timestamp for display. */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    return date.toLocaleDateString('de-DE', { month: 'short', day: 'numeric' });
  }

  // ============================================
  // History Dropdown Rendering (for ClaudianView)
  // ============================================

  /**
   * Renders the history dropdown content to a provided container.
   * Used by ClaudianView to render the dropdown with custom selection callback.
   */
  renderHistoryDropdown(
    container: HTMLElement,
    options: Omit<HistoryRenderOptions, 'onRerender'>,
  ): void {
    this.renderHistoryItems(container, {
      ...options,
      onRerender: () => this.renderHistoryDropdown(container, options),
    });
  }
}
