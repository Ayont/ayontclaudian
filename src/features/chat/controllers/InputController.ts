import { Notice, setIcon } from 'obsidian';

import {
  type BuiltInCommand,
  detectBuiltInCommand,
  isBuiltInCommandSupported,
} from '../../../core/commands/builtInCommands';
import { applyGoalPrefix, parseGoalArgs } from '../../../core/conversation/goalPrompt';
import { providerErrorRecoveryService } from '../../../core/diagnostics/errorRecovery';
import { ensureProviderHealthy } from '../../../core/diagnostics/providerHealthCheck';
import { buildDiffPreview } from '../../../core/diff/diffPreview';
import type { VaultRAGService } from '../../../core/intelligence/rag/VaultRAGService';
import {
  formatMemoryContext,
  loadMemoryNotes,
  rankMemoryNotes,
} from '../../../core/memory/memoryService';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type InstructionRefineService,
  type ProviderCapabilities,
  type ProviderId,
  type TitleGenerationService,
} from '../../../core/providers/types';
import { AUTO_MODEL_VALUE } from '../../../core/routing/modelRouterRules';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import {
  cloneChatTurnRequest,
  mergeQueuedChatTurns,
  type QueuedChatTurn,
} from '../../../core/runtime/QueuedTurn';
import type {
  ApprovalCallbackOptions,
  ApprovalDecisionOption,
  ChatTurnRequest,
} from '../../../core/runtime/types';
import { finishRunTimeline, recordRunTimelineChunk, startRunTimeline } from '../../../core/timeline/runTimeline';
import { TOOL_EXIT_PLAN_MODE } from '../../../core/tools/toolNames';
import type { ApprovalDecision, ChatMessage, ExitPlanModeDecision, StreamChunk } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { ResumeSessionDropdown } from '../../../shared/components/ResumeSessionDropdown';
import { InstructionModal } from '../../../shared/modals/InstructionConfirmModal';
import type { BrowserSelectionContext } from '../../../utils/browser';
import type { CanvasSelectionContext } from '../../../utils/canvas';
import { extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import type { EditorSelectionContext } from '../../../utils/editor';
import { appendMarkdownSnippet } from '../../../utils/markdown';
import { COMPLETION_FLAVOR_WORDS } from '../constants';
import { resolveAutoQuestionAnswers, summarizeAutoAnswers } from '../rendering/autoQuestionAnswer';
import { renderDiffContent, renderDiffStats } from '../rendering/DiffRenderer';
import { type InlineAskQuestionConfig, InlineAskUserQuestion } from '../rendering/InlineAskUserQuestion';
import { InlineExitPlanMode } from '../rendering/InlineExitPlanMode';
import { InlinePlanApproval,type PlanApprovalDecision } from '../rendering/InlinePlanApproval';
import type { MessageRenderer } from '../rendering/MessageRenderer';
import { setToolIcon, updateToolCallResult } from '../rendering/ToolCallRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { QueuedMessage } from '../state/types';
import type { FileContextManager } from '../ui/FileContext';
import type { ImageContextManager } from '../ui/ImageContext';
import type { AddExternalContextResult, McpServerSelector } from '../ui/InputToolbar';
import type { InstructionModeManager } from '../ui/InstructionModeManager';
import type { StatusPanel } from '../ui/StatusPanel';
import type { BrowserSelectionController } from './BrowserSelectionController';
import type { CanvasSelectionController } from './CanvasSelectionController';
import type { ConversationController } from './ConversationController';
import type { SelectionController } from './SelectionController';
import type { StreamController } from './StreamController';

const APPROVAL_OPTION_MAP: Record<string, ApprovalDecision> = {
  'Deny': 'deny',
  'Allow once': 'allow',
  'Always allow': 'allow-always',
};

const DEFAULT_APPROVAL_DECISION_OPTIONS: ApprovalDecisionOption[] =
  Object.entries(APPROVAL_OPTION_MAP).map(([label, decision]) => ({
    label,
    value: label,
    decision,
  }));

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export interface InputControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  streamController: StreamController;
  selectionController: SelectionController;
  browserSelectionController?: BrowserSelectionController;
  canvasSelectionController: CanvasSelectionController;
  conversationController: ConversationController;
  getInputEl: () => HTMLTextAreaElement;
  getWelcomeEl: () => HTMLElement | null;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  getImageContextManager: () => ImageContextManager | null;
  getMcpServerSelector: () => McpServerSelector | null;
  getExternalContextSelector: () => {
    getExternalContexts: () => string[];
    addExternalContext: (path: string) => AddExternalContextResult;
  } | null;
  getInstructionModeManager: () => InstructionModeManager | null;
  getInstructionRefineService: () => InstructionRefineService | null;
  getTitleGenerationService: () => TitleGenerationService | null;
  getStatusPanel: () => StatusPanel | null;
  getInputContainerEl: () => HTMLElement;
  generateId: () => string;
  resetInputHeight: () => void;
  getAuxiliaryModel?: () => string | null;
  getActiveModel?: () => string | null;
  getAgentService?: () => ChatRuntime | null;
  getSubagentManager: () => SubagentManager;
  /** Tab-level provider fallback for blank tabs (derived from draft model). */
  getTabProviderId?: () => ProviderId;
  /**
   * Consumes (returns and clears) a one-shot conversation-context bootstrap string set
   * when this conversation was switched to a different provider. Returns falsy when there
   * is no pending bootstrap (the normal same-provider case).
   */
  consumePendingContextBootstrap?: () => string | null | undefined;
  /** Reads the tab's active standing goal (provider-agnostic), if any. */
  getActiveGoal?: () => string | null;
  /** Sets (or clears, on null) the tab's standing goal. */
  setActiveGoal?: (goal: string | null) => void;
  /** Returns true if ready. */
  ensureServiceInitialized?: () => Promise<boolean>;
  openConversation?: (conversationId: string) => Promise<void>;
  getVaultRAGService?: () => VaultRAGService | null;
  onForkAll?: () => Promise<void>;
  restorePrePlanPermissionModeIfNeeded?: () => void;
}

/**
 * Default auto-mode loop guard: after this many consecutive auto-resolved prompts
 * (questions + plan approvals) without a manual user turn, pause once and surface
 * the next prompt for a human — a safety valve against runaway loops. Overridable
 * via `settings.autoModePauseAfter`.
 */
const DEFAULT_AUTO_MODE_PAUSE_AFTER = 25;

export class InputController {
  private deps: InputControllerDeps;
  /** Consecutive auto-answered questions since the last manual user send. */
  private autoAnswerStreak = 0;
  private pendingApprovalInline: InlineAskUserQuestion | null = null;
  private pendingAskInline: InlineAskUserQuestion | null = null;
  private pendingExitPlanModeInline: InlineExitPlanMode | null = null;
  private pendingPlanApproval: InlinePlanApproval | null = null;
  private pendingPlanApprovalInvalidated = false;
  private activeResumeDropdown: ResumeSessionDropdown | null = null;
  private inputContainerHideDepth = 0;
  private steerInFlight = false;
  private pendingSteerMessage: QueuedMessage | null = null;
  private softSteerInProgress = false;
  private activeStreamingAssistantMessage: ChatMessage | null = null;
  private pendingProviderUserMessages: Array<{
    displayContent: string;
    persistedContent?: string;
    currentNote?: string;
    images?: ChatMessage['images'];
  }> = [];
  private sawInitialProviderUserMessage = false;
  private awaitingProviderAssistantStart = false;

  constructor(deps: InputControllerDeps) {
    this.deps = deps;
  }

  private getAgentService(): ChatRuntime | null {
    return this.deps.getAgentService?.() ?? null;
  }

  /** Consecutive auto-resolutions allowed before auto mode pauses for a human. */
  private autoModePauseThreshold(): number {
    const configured = this.deps.plugin.settings.autoModePauseAfter;
    return typeof configured === 'number' && configured >= 1
      ? Math.floor(configured)
      : DEFAULT_AUTO_MODE_PAUSE_AFTER;
  }

  private getAuxiliaryModel(): string | null {
    return this.deps.getAuxiliaryModel?.()
      ?? this.getAgentService()?.getAuxiliaryModel?.()
      ?? null;
  }

  private syncInstructionRefineModelOverride(
    instructionRefineService: InstructionRefineService,
  ): void {
    instructionRefineService.setModelOverride?.(this.getAuxiliaryModel() ?? undefined);
  }

  private getActiveProviderId(): ProviderId {
    const agentService = this.getAgentService();
    const conversationId = this.deps.state.currentConversationId;
    if (!conversationId) {
      return this.deps.getTabProviderId?.() ?? agentService?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
    }

    if (agentService?.providerId) {
      return agentService.providerId;
    }

    return this.deps.plugin.getConversationSync(conversationId)?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getActiveCapabilities(): ProviderCapabilities {
    const providerId = this.getActiveProviderId();
    const agentService = this.getAgentService();
    if (agentService?.providerId === providerId) {
      return agentService.getCapabilities();
    }

    return ProviderRegistry.getCapabilities(providerId);
  }

  private isResumeSessionAtStillNeeded(resumeUuid: string, previousMessages: ChatMessage[]): boolean {
    for (let i = previousMessages.length - 1; i >= 0; i--) {
      if (previousMessages[i].role === 'assistant' && previousMessages[i].assistantMessageId === resumeUuid) {
        // Still needed only if no messages follow the resume point
        return i === previousMessages.length - 1;
      }
    }
    return false;
  }

  // ============================================
  // Message Sending
  // ============================================

  async sendMessage(options?: {
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
    content?: string;
    images?: ChatMessage['images'];
    turnRequestOverride?: ChatTurnRequest;
  }): Promise<void> {
    const {
      plugin,
      state,
      renderer,
      streamController,
      selectionController,
      browserSelectionController,
      canvasSelectionController,
      conversationController
    } = this.deps;

    // During conversation creation/switching, don't send - input is preserved so user can retry
    if (state.isCreatingConversation || state.isSwitchingConversation) return;

    // A manual user turn restarts the auto-mode answer budget (see loop guard).
    this.autoAnswerStreak = 0;

    const inputEl = this.deps.getInputEl();
    const imageContextManager = this.deps.getImageContextManager();
    const fileContextManager = this.deps.getFileContextManager();

    const contentOverride = options?.content;
    const shouldUseInput = contentOverride === undefined;
    const content = (contentOverride ?? inputEl.value).trim();
    const imageOverride = options?.images;
    const hasImages = imageOverride !== undefined
      ? imageOverride.length > 0
      : (imageContextManager?.hasImages() ?? false);
    if (!content && !hasImages) return;

    // Check for built-in commands first (e.g., /clear, /new, /add-dir)
    const builtInCmd = detectBuiltInCommand(content);
    if (builtInCmd) {
      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      await this.executeBuiltInCommand(builtInCmd.command, builtInCmd.args);
      return;
    }

    // Auto model (selected from the dropdown): route to the best model for this
    // prompt before sending. When "Auto" is the active model, the router picks
    // the best matching model for the actual send — but Auto stays selected in
    // the dropdown so the user doesn't have to re-select it every time.
    const activeModelForRouting = this.deps.getActiveModel?.() ?? null;
    if (shouldUseInput && activeModelForRouting === AUTO_MODEL_VALUE && plugin.settings.modelRouterEnabled !== false) {
      try {
        const tab = plugin.getView()?.getActiveTab();
        if (tab) {
          const { ProviderSettingsCoordinator } = await import('../../../core/providers/ProviderSettingsCoordinator');
          const decision = plugin.resolveModelRouteForInput(content, tab);
          if (decision) {
            // Don't call selectModel() — that would trigger onModelChange and
            // deactivate Auto. Instead, record the routed model and update the
            // provider settings so the actual send uses the routed model.
            // Auto (draftModel === __auto__) stays active in the dropdown.
            tab.routedModel = decision.model;
            tab.autoModelActive = true;
            tab.draftModel = AUTO_MODEL_VALUE;
            const snapshot = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
              plugin.settings,
              tab.providerId,
            );
            snapshot.model = decision.model;
            ProviderSettingsCoordinator.commitProviderSettingsSnapshot(
              plugin.settings,
              tab.providerId,
              snapshot,
            );
            await plugin.saveSettings();
            tab.ui.modelSelector?.updateDisplay();
          }
        }
      } catch {
        // Auto-routing is best-effort; never block the send on a routing failure.
      }
    }

    // Token-budget guard: block new turns when the daily/session budget is spent.
    if (plugin.settings.tokenBudgetEnabled !== false && plugin.tokenBudgetTracker) {
      const budgetCheck = plugin.tokenBudgetTracker.checkBudget(plugin.settings);
      if (budgetCheck?.ok === false) {
        new Notice(budgetCheck.reason ?? 'Token budget reached.');
        return;
      }
    }

    // If agent is working, queue the message instead of dropping it
    if (state.isStreaming) {
      const images = hasImages
        ? [...(imageOverride ?? imageContextManager?.getAttachedImages() ?? [])]
        : undefined;
      const editorContext = selectionController.getContext();
      const browserContext = browserSelectionController?.getContext() ?? null;
      const canvasContext = canvasSelectionController.getContext();
      const { displayContent, turnRequest } = this.buildTurnSubmission({
        content,
        images,
        editorContextOverride: editorContext,
        browserContextOverride: browserContext,
        canvasContextOverride: canvasContext,
      });
      state.queuedMessage = this.mergeQueuedMessages(
        state.queuedMessage,
        this.createQueuedMessage(displayContent, turnRequest),
      );

      if (shouldUseInput) {
        inputEl.value = '';
        this.deps.resetInputHeight();
      }
      if (shouldUseInput) {
        imageContextManager?.clearImages();
      }
      this.updateQueueIndicator();
      return;
    }

    if (shouldUseInput) {
      inputEl.value = '';
      this.deps.resetInputHeight();
    }
    state.isStreaming = true;
    state.cancelRequested = false;
    state.ignoreUsageUpdates = false; // Allow usage updates for new query
    this.deps.getSubagentManager().resetSpawnedCount();
    state.autoScrollEnabled = plugin.settings.enableAutoScroll ?? true; // Reset auto-scroll based on setting
    const streamGeneration = state.bumpStreamGeneration();

    // Hide welcome message when sending first message
    const welcomeEl = this.deps.getWelcomeEl();
    if (welcomeEl) {
      welcomeEl.addClass('claudian-hidden');
    }

    fileContextManager?.startSession();

    // Slash commands are passed directly to SDK for handling
    // SDK handles expansion, $ARGUMENTS, @file references, and frontmatter options
    const images = imageOverride ?? imageContextManager?.getAttachedImages() ?? [];
    const imagesForMessage = images.length > 0 ? [...images] : undefined;
    const isCompact = /^\/compact(\s|$)/i.test(content);

    // Only clear images if we consumed user input (not for programmatic content override).
    // Keep staged copies so images remain available for reuse after sending.
    if (shouldUseInput) {
      imageContextManager?.clearImages();
    }

    const turnSubmission = options?.turnRequestOverride
      ? {
        displayContent: content,
        turnRequest: cloneChatTurnRequest(options.turnRequestOverride),
      }
      : this.buildTurnSubmission({
        content,
        images: imagesForMessage,
        editorContextOverride: options?.editorContextOverride,
        browserContextOverride: options?.browserContextOverride,
        canvasContextOverride: options?.canvasContextOverride,
      });
    const { displayContent } = turnSubmission;
    // `turnRequest` may be reassigned below to prepend a one-shot cross-provider bootstrap.
    let turnRequest = turnSubmission.turnRequest;

    if (!options?.turnRequestOverride && plugin.settings.memoryEnabled !== false && plugin.app?.vault) {
      const memoryNotes = await loadMemoryNotes(
        plugin.app.vault,
        plugin.settings.memoryFolder ?? '.claudian/memory',
      );
      const memoryCandidates = rankMemoryNotes(displayContent, memoryNotes, {
        limit: plugin.settings.memoryMaxNotes ?? 5,
      });
      const memoryContext = formatMemoryContext(memoryCandidates);
      if (memoryContext) {
        turnRequest.text = `${memoryContext}\n\n${turnRequest.text}`;
      }

      const ragService = this.deps.getVaultRAGService?.();
      if (ragService) {
        const ragChunks = await ragService.query(displayContent, { limit: 3 });
        if (ragChunks.length > 0) {
          const ragContext = `<vault_context>\nRelevant vault knowledge:\n\n${ragChunks.map(chunk => `- From [[${chunk.path}]] (score ${(chunk.score * 100).toFixed(0)}%):\n  ${chunk.text.slice(0, 400)}`).join('\n\n')}\n</vault_context>`;
          turnRequest.text = `${ragContext}\n\n${turnRequest.text}`;
        }
      }
    }

    fileContextManager?.markCurrentNoteSent();

    const userMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'user',
      content: displayContent,
      displayContent,                // Original user input (for UI display)
      timestamp: Date.now(),
      images: imagesForMessage,
    };
    state.addMessage(userMsg);
    state.hasPendingConversationSave = true;
    renderer.addMessage(userMsg);

    await this.triggerTitleGeneration();

    const assistantMsg: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    state.addMessage(assistantMsg);
    this.activeStreamingAssistantMessage = assistantMsg;
    this.activateStreamingAssistantMessage(assistantMsg);

    // Persist the conversation immediately after the user message (and its
    // placeholder assistant turn) so the chat survives plugin reloads, crashes,
    // or mid-stream closures for every model and provider.
    await this.deps.conversationController.save();
    this.pendingProviderUserMessages = [{
      displayContent,
      images: imagesForMessage,
    }];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = true;

    streamController.showThinkingIndicator(
      isCompact ? 'Compacting...' : undefined,
      isCompact ? 'claudian-thinking--compact' : undefined,
    );
    state.responseStartTime = performance.now();

    let wasInterrupted = false;
    let wasInvalidated = false;
    let didEnqueueToSdk = false;
    let planCompleted = false;

    // Lazy initialization: ensure service is ready before first query
    if (this.deps.ensureServiceInitialized) {
      const ready = await this.deps.ensureServiceInitialized();
      if (!ready) {
        new Notice('Failed to initialize agent service. Please try again.');
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        this.activeStreamingAssistantMessage = null;
        this.resetProviderMessageBoundaryState();
        return;
      }
    }

    const agentService = this.getAgentService();
    if (!agentService) {
      new Notice('Agent service not available. Please reload the plugin.');
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      return;
    }

    const health = await ensureProviderHealthy(
      agentService.providerId,
      plugin.settings as unknown as Record<string, unknown>,
    );
    if (!health.ok) {
      new Notice(health.error ?? 'Provider is not reachable.');
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
      state.isStreaming = false;
      return;
    }

    const activeModelForTimeline = this.deps.getActiveModel?.() ?? null;
    const timelineModel = activeModelForTimeline === AUTO_MODEL_VALUE
      ? (plugin.getView()?.getActiveTab()?.routedModel ?? this.getAuxiliaryModel())
      : (activeModelForTimeline ?? this.getAuxiliaryModel());

    const runTimeline = startRunTimeline({
      conversationId: state.currentConversationId,
      providerId: agentService.providerId,
      model: timelineModel,
      prompt: displayContent,
      currentNote: turnRequest.currentNotePath ?? null,
      externalContextPaths: turnRequest.externalContextPaths,
    });

    // Restore pendingResumeAt from persisted conversation state (survives plugin reload)
    const conversationIdForSend = state.currentConversationId;
    if (conversationIdForSend) {
      const conv = plugin.getConversationSync(conversationIdForSend);
      if (conv?.resumeAtMessageId) {
        if (this.isResumeSessionAtStillNeeded(conv.resumeAtMessageId, state.messages.slice(0, -2))) {
          agentService.setResumeCheckpoint(conv.resumeAtMessageId);
        } else {
          try {
            await plugin.updateConversation(conversationIdForSend, { resumeAtMessageId: undefined });
          } catch {
            // Best-effort — don't block send
          }
        }
      }
    }

    try {
      // Pass history WITHOUT current turn (userMsg + assistantMsg we just added).
      // This prevents duplication when rebuilding context for new sessions.
      const previousMessages = state.messages.slice(0, -2);

      // One-shot cross-provider context carry: when this conversation was just switched
      // to a different provider, prepend a BOUNDED, framed snapshot of prior turns to the
      // FIRST turn only so the freshly-started provider session has minimal context.
      // The snapshot was already built + stashed at switch time (switchBoundTabProvider),
      // so we reuse it verbatim instead of rebuilding. Consumed exactly once; no-op on
      // normal same-provider turns.
      const pendingBootstrap = this.deps.consumePendingContextBootstrap?.();
      if (pendingBootstrap) {
        turnRequest = {
          ...turnRequest,
          text: turnRequest.text
            ? `${pendingBootstrap}\n\n${turnRequest.text}`
            : pendingBootstrap,
        };
      }

      // Standing goal: re-inject the framed objective into the sent prompt for ANY
      // provider so it stays in view each turn. Only the sent/persisted text carries
      // it — the displayed user bubble keeps the raw `displayContent`.
      const activeGoal = this.deps.getActiveGoal?.() ?? null;
      if (activeGoal) {
        turnRequest = { ...turnRequest, text: applyGoalPrefix(turnRequest.text, activeGoal) };
      }

      const preparedTurn = agentService.prepareTurn(turnRequest);
      userMsg.content = preparedTurn.persistedContent;
      userMsg.currentNote = preparedTurn.isCompact
        ? undefined
        : preparedTurn.request.currentNotePath;
      for await (const chunk of agentService.query(preparedTurn, previousMessages)) {
        if (state.streamGeneration !== streamGeneration) {
          wasInvalidated = true;
          break;
        }
        if (state.cancelRequested) {
          wasInterrupted = true;
          break;
        }

        // Soft steer in progress: the active stream is being cancelled so the
        // queued message can be re-sent as a fresh turn. Skip all chunks from
        // the dying stream (abort errors, trailing text, done markers).
        if (this.softSteerInProgress) {
          continue;
        }

        recordRunTimelineChunk(runTimeline, chunk);

        if (await this.handleProviderMessageBoundaryChunk(chunk)) {
          continue;
        }

        await streamController.handleStreamChunk(
          chunk,
          this.activeStreamingAssistantMessage ?? assistantMsg,
        );
      }
    } catch (error) {
      if (this.softSteerInProgress) {
        // Soft steer cancelled the stream — suppress the abort error.
      } else {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        const errorMsg = normalizedError.message;
        recordRunTimelineChunk(runTimeline, { type: 'error', content: errorMsg });
        if (agentService) {
          providerErrorRecoveryService.recordError(agentService.providerId, normalizedError);
        }
        await streamController.handleStreamChunk(
          { type: 'error', content: errorMsg },
          this.activeStreamingAssistantMessage ?? assistantMsg,
        );
      }
    } finally {
      const finalAssistantMsg = this.activeStreamingAssistantMessage ?? assistantMsg;
      const turnMetadata = agentService.consumeTurnMetadata();
      userMsg.userMessageId = turnMetadata.userMessageId ?? userMsg.userMessageId;
      finalAssistantMsg.assistantMessageId = turnMetadata.assistantMessageId ?? finalAssistantMsg.assistantMessageId;
      didEnqueueToSdk = didEnqueueToSdk || turnMetadata.wasSent === true;
      planCompleted = planCompleted || turnMetadata.planCompleted === true;

      // ALWAYS clear the timer interval, even on stream invalidation (prevents memory leaks)
      state.clearFlavorTimerInterval();

      // Skip remaining cleanup if stream was invalidated (tab closed or conversation switched)
      if (!wasInvalidated && state.streamGeneration === streamGeneration) {
        const didCancelThisTurn = wasInterrupted || state.cancelRequested;
        if (didCancelThisTurn && !state.pendingNewSessionPlan && !this.softSteerInProgress) {
          await streamController.appendText('\n\n<span class="claudian-interrupted">Interrupted</span> <span class="claudian-interrupted-hint">· What should Claudian do instead?</span>');
        }
        streamController.hideThinkingIndicator();
        state.isStreaming = false;
        state.cancelRequested = false;
        this.restorePendingSteerMessageToQueue();

        // Capture response duration before resetting state (skip for interrupted responses and compaction)
        const hasCompactBoundary = finalAssistantMsg.contentBlocks?.some(b => b.type === 'context_compacted');
        if (!didCancelThisTurn && !hasCompactBoundary) {
          const durationSeconds = state.responseStartTime
            ? Math.floor((performance.now() - state.responseStartTime) / 1000)
            : 0;
          if (durationSeconds > 0) {
            const flavorWord =
              COMPLETION_FLAVOR_WORDS[Math.floor(Math.random() * COMPLETION_FLAVOR_WORDS.length)];
            finalAssistantMsg.durationSeconds = durationSeconds;
            finalAssistantMsg.durationFlavorWord = flavorWord;
            // Add footer to live message in DOM
            if (state.currentContentEl) {
              const footerEl = state.currentContentEl.createDiv({ cls: 'claudian-response-footer' });
              footerEl.createSpan({
                text: `* ${flavorWord} for ${formatDurationMmSs(durationSeconds)}`,
                cls: 'claudian-baked-duration',
              });
            }
          }
        }

        state.currentContentEl = null;

        await streamController.finalizeCurrentThinkingBlock(finalAssistantMsg);
        await streamController.finalizeCurrentTextBlock(finalAssistantMsg);
        this.deps.getSubagentManager().resetStreamingState();

        // Auto-hide completed todo panel on response end
        // Panel reappears only when new TodoWrite tool is called
        if (state.currentTodos && state.currentTodos.every(t => t.status === 'completed')) {
          state.currentTodos = null;
        }
        this.syncScrollToBottomAfterRenderUpdates();

        // approve-new-session: the tool_result chunk is dropped because cancelRequested
        // was set before the stream loop could process it — manually set the result so
        // the saved conversation renders correctly when revisited
        if (state.pendingNewSessionPlan && finalAssistantMsg.toolCalls) {
          for (const tc of finalAssistantMsg.toolCalls) {
            if (tc.name === TOOL_EXIT_PLAN_MODE && !tc.result) {
              tc.status = 'completed';
              tc.result = 'User approved the plan and started a new session.';
              updateToolCallResult(tc.id, tc, state.toolCallElements);
            }
          }
        }

        // Provider-agnostic post-plan approval: show UI and await decision before save/auto-send
        let planAutoSendContent: string | null = null;
        let planApprovalInvalidated = false;
        let shouldProcessQueuedMessage = true;
        if (planCompleted && !didCancelThisTurn) {
          const { decision, invalidated } = await this.showPlanApproval();

          // Re-check invalidation after async approval prompt
          if (state.streamGeneration !== streamGeneration || invalidated) {
            planApprovalInvalidated = true;
          } else if (decision?.type === 'implement') {
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
            planAutoSendContent = 'Implement the plan.';
          } else if (decision?.type === 'revise') {
            // Keep plan mode active, populate input with feedback text
            this.deps.getInputEl().value = decision.text;
            shouldProcessQueuedMessage = false;
          } else {
            // cancel or null (dismissed)
            this.deps.restorePrePlanPermissionModeIfNeeded?.();
          }
        }

        if (!planApprovalInvalidated) {
          // Only clear resumeAtMessageId if enqueue succeeded; preserve checkpoint on failure for retry
          const saveExtras = didEnqueueToSdk ? { resumeAtMessageId: undefined } : undefined;
          await conversationController.save(true, saveExtras);

          const userMsgIndex = state.messages.indexOf(userMsg);
          renderer.refreshActionButtons(userMsg, state.messages, userMsgIndex >= 0 ? userMsgIndex : undefined);

          // Auto-implement takes precedence over both approve-new-session and queued input
          if (planAutoSendContent) {
            this.deps.getInputEl().value = planAutoSendContent;
            this.sendMessage().catch(() => {});
          } else {
            // approve-new-session: create fresh conversation and send plan content
            // Must be inside the invalidation guard — if the tab was closed or
            // conversation switched, we must not create a new session on stale state.
            const planContent = state.pendingNewSessionPlan;
            if (planContent) {
              state.pendingNewSessionPlan = null;
              await conversationController.createNew();
              this.deps.getInputEl().value = planContent;
              this.sendMessage().catch(() => {
                // sendMessage() handles its own errors internally; this prevents
                // unhandled rejection if an unexpected error slips through.
              });
            } else if (shouldProcessQueuedMessage) {
              this.processQueuedMessage();
            }
          }
        }
      }

      if (wasInvalidated) {
        this.clearPendingSteerState();
        this.updateQueueIndicator();
      }

      finishRunTimeline(
        runTimeline,
        wasInvalidated ? 'invalidated' : wasInterrupted || state.cancelRequested ? 'interrupted' : 'success',
      );
      this.activeStreamingAssistantMessage = null;
      this.resetProviderMessageBoundaryState();
    }
  }

  // ============================================
  // Queue Management
  // ============================================

  updateQueueIndicator(): void {
    const { state } = this.deps;
    const indicatorEl = state.queueIndicatorEl;
    if (!indicatorEl) return;

    indicatorEl.empty();

    const visibleQueuedMessage = state.queuedMessage ?? this.pendingSteerMessage;
    if (visibleQueuedMessage) {
      const isPendingSteerOnly = !state.queuedMessage && !!this.pendingSteerMessage;
      indicatorEl.createSpan({
        cls: 'claudian-queue-indicator-text',
        text: `${isPendingSteerOnly ? '⌙ Steering: ' : '⌙ Queued: '}${this.getQueuedMessageDisplay(visibleQueuedMessage)}`,
      });

      if (state.queuedMessage) {
        const actionsEl = indicatorEl.createDiv({ cls: 'claudian-queue-indicator-actions' });

        if (this.canSteerQueuedMessage()) {
          const steerButton = actionsEl.createEl('button', {
            cls: 'claudian-queue-indicator-action',
            text: this.steerInFlight ? 'Steering...' : 'Steer Now',
          });
          steerButton.setAttribute('type', 'button');
          if (this.steerInFlight) {
            steerButton.setAttribute('disabled', 'true');
          } else {
            steerButton.addEventListener('click', (event) => {
              event.stopPropagation();
              void this.steerQueuedMessage();
            });
          }
        }

        const editButton = this.createQueueIconButton(
          actionsEl,
          'pencil',
          'Edit queued message',
        );
        editButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.withdrawQueuedMessageToComposer();
        });

        const discardButton = this.createQueueIconButton(
          actionsEl,
          'trash-2',
          'Discard queued message',
        );
        discardButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.clearQueuedMessage();
        });
      }

      indicatorEl.addClass('claudian-visible-flex');
      indicatorEl.removeClass('claudian-hidden');
      return;
    }

    indicatorEl.removeClass('claudian-visible-flex');
    indicatorEl.addClass('claudian-hidden');
  }

  clearQueuedMessage(): void {
    const { state } = this.deps;
    state.queuedMessage = null;
    this.updateQueueIndicator();
  }

  withdrawQueuedMessageToComposer(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.restoreMessageToInput(queuedMessage, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private restoreMessageToInput(
    message: QueuedMessage | null,
    options: { mergeWithComposer?: boolean } = {},
  ): void {
    if (!message) return;

    const { content, images } = message;
    const inputEl = this.deps.getInputEl();
    const currentContent = options.mergeWithComposer ? inputEl.value.trim() : '';
    inputEl.value = currentContent
      ? appendMarkdownSnippet(content, currentContent)
      : content;

    const imageContextManager = this.deps.getImageContextManager();
    const currentImages = options.mergeWithComposer
      ? (imageContextManager?.getAttachedImages() ?? [])
      : [];
    const restoredImages = [...(images ?? []), ...currentImages];
    if (restoredImages.length > 0) {
      imageContextManager?.setImages(restoredImages);
    }
    this.deps.resetInputHeight();
    inputEl.focus();
  }

  private restorePendingMessagesToInput(): void {
    const { state } = this.deps;
    const combinedMessage = this.mergePendingMessages(
      this.pendingSteerMessage,
      state.queuedMessage,
    );
    this.restoreMessageToInput(combinedMessage, { mergeWithComposer: true });
    state.queuedMessage = null;
    this.clearPendingSteerState();
    this.updateQueueIndicator();
  }

  private processQueuedMessage(): void {
    const { state } = this.deps;
    if (!state.queuedMessage) return;

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.updateQueueIndicator();

    window.setTimeout(
      () => {
        void this.sendMessage({
          content: queuedMessage.content,
          images: queuedMessage.images,
          turnRequestOverride: this.toQueuedChatTurn(queuedMessage).request,
        });
      },
      0
    );
  }

  private buildTurnSubmission(options: {
    content: string;
    images?: ChatMessage['images'];
    editorContextOverride?: EditorSelectionContext | null;
    browserContextOverride?: BrowserSelectionContext | null;
    canvasContextOverride?: CanvasSelectionContext | null;
  }): {
    displayContent: string;
    turnRequest: ChatTurnRequest;
  } {
    const {
      selectionController,
      browserSelectionController,
      canvasSelectionController,
    } = this.deps;

    const fileContextManager = this.deps.getFileContextManager();
    const mcpServerSelector = this.deps.getMcpServerSelector();
    const externalContextSelector = this.deps.getExternalContextSelector();

    const currentNotePath = fileContextManager?.getCurrentNotePath() || null;
    const shouldSendCurrentNote = fileContextManager?.shouldSendCurrentNote(currentNotePath) ?? false;

    const editorContext = options.editorContextOverride !== undefined
      ? options.editorContextOverride
      : selectionController.getContext();
    const browserContext = options.browserContextOverride !== undefined
      ? options.browserContextOverride
      : (browserSelectionController?.getContext() ?? null);
    const canvasContext = options.canvasContextOverride !== undefined
      ? options.canvasContextOverride
      : canvasSelectionController.getContext();

    const externalContextPaths = externalContextSelector?.getExternalContexts();
    const isCompact = /^\/compact(\s|$)/i.test(options.content);
    const transformedText = !isCompact && fileContextManager
      ? fileContextManager.transformContextMentions(options.content)
      : options.content;
    const enabledMcpServers = mcpServerSelector?.getEnabledServers();

    return {
      displayContent: options.content,
      turnRequest: {
        text: transformedText,
        images: options.images,
        currentNotePath: shouldSendCurrentNote && currentNotePath ? currentNotePath : undefined,
        editorSelection: editorContext,
        browserSelection: browserContext,
        canvasSelection: canvasContext,
        externalContextPaths: externalContextPaths && externalContextPaths.length > 0
          ? externalContextPaths
          : undefined,
        enabledMcpServers: enabledMcpServers && enabledMcpServers.size > 0
          ? enabledMcpServers
          : undefined,
      },
    };
  }

  private getQueuedMessageDisplay(message: QueuedMessage | null): string {
    if (!message) {
      return '';
    }

    const rawContent = message.content.trim();
    const preview = rawContent.length > 40
      ? rawContent.slice(0, 40) + '...'
      : rawContent;
    const hasImages = (message.images?.length ?? 0) > 0;

    if (hasImages) {
      return preview ? `${preview} [images]` : '[images]';
    }

    return preview;
  }

  private createQueueIconButton(
    parentEl: HTMLElement,
    icon: string,
    label: string,
  ): HTMLElement {
    const button = parentEl.createEl('button', {
      cls: 'claudian-queue-indicator-icon-action',
      attr: {
        'aria-label': label,
        title: label,
        type: 'button',
      },
    });
    setIcon(button, icon);
    return button;
  }

  private canSteerQueuedMessage(): boolean {
    const agentService = this.getAgentService();
    return this.deps.state.isStreaming
      && this.getActiveCapabilities().supportsTurnSteer === true
      && (typeof agentService?.steer === 'function' || typeof agentService?.softSteer === 'function');
  }

  private cloneQueuedMessage(message: QueuedMessage): QueuedMessage {
    return {
      ...message,
      images: message.images ? [...message.images] : undefined,
      turnRequest: message.turnRequest
        ? cloneChatTurnRequest(message.turnRequest)
        : undefined,
    };
  }

  private createQueuedMessage(displayContent: string, turnRequest: ChatTurnRequest): QueuedMessage {
    const request = cloneChatTurnRequest(turnRequest);
    return {
      content: displayContent,
      images: request.images,
      editorContext: request.editorSelection ?? null,
      browserContext: request.browserSelection ?? null,
      canvasContext: request.canvasSelection ?? null,
      turnRequest: request,
    };
  }

  private toQueuedChatTurn(message: QueuedMessage): QueuedChatTurn {
    if (message.turnRequest) {
      return {
        displayContent: message.content,
        request: cloneChatTurnRequest(message.turnRequest),
      };
    }

    return {
      displayContent: message.content,
      request: {
        text: message.content,
        images: message.images ? [...message.images] : undefined,
        editorSelection: message.editorContext,
        browserSelection: message.browserContext ?? null,
        canvasSelection: message.canvasContext,
      },
    };
  }

  private mergePendingMessages(
    first: QueuedMessage | null,
    second: QueuedMessage | null,
  ): QueuedMessage | null {
    if (first && second) {
      return this.mergeQueuedMessages(first, second);
    }

    if (first) {
      return this.cloneQueuedMessage(first);
    }

    if (second) {
      return this.cloneQueuedMessage(second);
    }

    return null;
  }

  private clearPendingSteerState(): void {
    this.pendingSteerMessage = null;
    this.steerInFlight = false;
    this.softSteerInProgress = false;
  }

  private restorePendingSteerMessageToQueue(): void {
    if (!this.pendingSteerMessage) {
      return;
    }

    const { state } = this.deps;
    const pendingSteerMessage = this.cloneQueuedMessage(this.pendingSteerMessage);
    this.clearPendingSteerState();
    state.queuedMessage = state.queuedMessage
      ? this.mergeQueuedMessages(pendingSteerMessage, state.queuedMessage)
      : pendingSteerMessage;
    this.updateQueueIndicator();
  }

  private mergeQueuedMessages(
    existing: QueuedMessage | null,
    incoming: QueuedMessage,
  ): QueuedMessage {
    if (!existing) {
      return this.cloneQueuedMessage(incoming);
    }

    const mergedTurn = mergeQueuedChatTurns(
      this.toQueuedChatTurn(existing),
      this.toQueuedChatTurn(incoming),
    );
    return this.createQueuedMessage(mergedTurn.displayContent, mergedTurn.request);
  }

  private async steerQueuedMessage(): Promise<void> {
    if (this.steerInFlight) {
      return;
    }

    const { state } = this.deps;
    const agentService = this.getAgentService();
    const hasNativeSteer = typeof agentService?.steer === 'function';
    const hasSoftSteer = typeof agentService?.softSteer === 'function';
    if (!state.queuedMessage || !this.canSteerQueuedMessage() || !agentService || (!hasNativeSteer && !hasSoftSteer)) {
      return;
    }

    if (!hasNativeSteer && hasSoftSteer) {
      await this.steerQueuedMessageSoft(agentService);
      return;
    }

    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.updateQueueIndicator();

    try {
      const { displayContent, request } = this.toQueuedChatTurn(queuedMessage);

      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.steer!(preparedTurn);
      if (state.cancelRequested || !this.pendingSteerMessage) {
        return;
      }
      if (!accepted) {
        this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
        return;
      }

      this.deps.getFileContextManager()?.markCurrentNoteSent();

      this.pendingProviderUserMessages.push({
        displayContent,
        persistedContent: preparedTurn.persistedContent,
        currentNote: preparedTurn.isCompact
          ? undefined
          : preparedTurn.request.currentNotePath,
        images: request.images,
      });
    } catch {
      this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      new Notice('Failed to steer the queued message. It is still available.');
    }
  }

  /**
   * Soft steer: for providers without a native mid-turn steer primitive.
   *
   * Cancels the active stream (via `runtime.softSteer()`) so the current
   * `sendMessage()` turn ends. Its `finally` block then restores
   * `pendingSteerMessage` to the queue and `processQueuedMessage()` re-sends
   * the conversation with the steer message appended as a fresh turn — full
   * history included. The `softSteerInProgress` flag suppresses stray error
   * chunks and the "Interrupted" hint from the dying stream.
   */
  private async steerQueuedMessageSoft(agentService: ChatRuntime): Promise<void> {
    const { state } = this.deps;
    if (!state.queuedMessage) {
      return;
    }
    const queuedMessage = this.cloneQueuedMessage(state.queuedMessage);
    state.queuedMessage = null;
    this.pendingSteerMessage = queuedMessage;
    this.steerInFlight = true;
    this.softSteerInProgress = true;
    this.updateQueueIndicator();

    try {
      const { request } = this.toQueuedChatTurn(queuedMessage);
      const preparedTurn = agentService.prepareTurn(request);
      const accepted = await agentService.softSteer!(preparedTurn);
      if (!accepted) {
        this.clearPendingSteerState();
        this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      }
      // On success the active sendMessage() finally block restores the queued
      // message and processQueuedMessage() re-sends it — nothing to do here.
    } catch {
      this.clearPendingSteerState();
      this.restoreQueuedMessageAfterSteerFailure(queuedMessage);
      new Notice('Failed to steer the queued message. It is still available.');
    }
  }

  private restoreQueuedMessageAfterSteerFailure(
    message: QueuedMessage,
  ): void {
    const { state } = this.deps;
    this.clearPendingSteerState();
    if (state.cancelRequested) {
      this.updateQueueIndicator();
      return;
    }

    if (state.isStreaming) {
      state.queuedMessage = state.queuedMessage
        ? this.mergeQueuedMessages(message, state.queuedMessage)
        : message;
      this.updateQueueIndicator();
      return;
    }

    this.restoreMessageToInput(message, { mergeWithComposer: true });
    this.updateQueueIndicator();
  }

  private activateStreamingAssistantMessage(message: ChatMessage): void {
    const { state, renderer } = this.deps;
    const msgEl = renderer.addMessage(message);
    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');

    if (!contentEl) {
      return;
    }

    if (!state.currentContentEl) {
      state.toolCallElements.clear();
    }

    state.currentContentEl = contentEl;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  private resetProviderMessageBoundaryState(): void {
    this.pendingProviderUserMessages = [];
    this.sawInitialProviderUserMessage = false;
    this.awaitingProviderAssistantStart = false;
  }

  private async handleProviderMessageBoundaryChunk(chunk: StreamChunk): Promise<boolean> {
    switch (chunk.type) {
      case 'user_message_start':
        await this.handleProviderUserMessageStart(chunk);
        return true;
      case 'assistant_message_start':
        await this.handleProviderAssistantMessageStart();
        return true;
      default:
        return false;
    }
  }

  private async handleProviderUserMessageStart(
    chunk: Extract<StreamChunk, { type: 'user_message_start' }>,
  ): Promise<void> {
    const expected = this.pendingProviderUserMessages.shift();
    if (!this.sawInitialProviderUserMessage) {
      this.sawInitialProviderUserMessage = true;
      return;
    }

    this.clearPendingSteerState();
    this.updateQueueIndicator();

    const previousAssistant = this.activeStreamingAssistantMessage;
    const shouldDiscardPlaceholder = this.shouldDiscardPendingAssistantPlaceholder(previousAssistant);
    if (previousAssistant) {
      if (shouldDiscardPlaceholder) {
        this.discardStreamingAssistantMessage(previousAssistant.id);
      } else {
        await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
        await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
      }
    }
    this.deps.streamController.hideThinkingIndicator();

    const displayContent = expected?.displayContent ?? chunk.content;
    const persistedContent = expected?.persistedContent ?? displayContent;
    const images = expected?.images;
    if (displayContent || (images?.length ?? 0) > 0) {
      const userMessage: ChatMessage = {
        id: this.deps.generateId(),
        role: 'user',
        content: persistedContent,
        displayContent,
        timestamp: Date.now(),
        currentNote: expected?.currentNote,
        images,
      };
      this.deps.state.addMessage(userMessage);
      this.deps.renderer.addMessage(userMessage);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
    this.deps.state.responseStartTime = performance.now();
    this.awaitingProviderAssistantStart = true;
  }

  private async handleProviderAssistantMessageStart(): Promise<void> {
    if (this.awaitingProviderAssistantStart) {
      this.awaitingProviderAssistantStart = false;
      return;
    }

    const previousAssistant = this.activeStreamingAssistantMessage;
    if (previousAssistant) {
      await this.deps.streamController.finalizeCurrentThinkingBlock(previousAssistant);
      await this.deps.streamController.finalizeCurrentTextBlock(previousAssistant);
    }

    const assistantMessage: ChatMessage = {
      id: this.deps.generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      toolCalls: [],
      contentBlocks: [],
    };
    this.deps.state.addMessage(assistantMessage);
    this.activeStreamingAssistantMessage = assistantMessage;
    this.activateStreamingAssistantMessage(assistantMessage);
    this.deps.streamController.showThinkingIndicator();
  }

  private shouldDiscardPendingAssistantPlaceholder(message: ChatMessage | null): boolean {
    return this.awaitingProviderAssistantStart
      && !!message
      && !message.content.trim()
      && (message.toolCalls?.length ?? 0) === 0
      && (message.contentBlocks?.length ?? 0) === 0;
  }

  private discardStreamingAssistantMessage(messageId: string): void {
    const { state, renderer } = this.deps;
    state.messages = state.messages.filter((message) => message.id !== messageId);
    renderer.removeMessage(messageId);
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    state.currentThinkingState = null;
  }

  // ============================================
  // Title Generation
  // ============================================

  /**
   * Triggers AI title generation after first user message.
   * Handles setting fallback title, firing async generation, and updating UI.
   */
  private async triggerTitleGeneration(): Promise<void> {
    const { plugin, state, conversationController } = this.deps;

    if (state.messages.length !== 1) {
      return;
    }

    if (!state.currentConversationId) {
      const sessionId = this.getAgentService()?.getSessionId() ?? undefined;
      const conversation = await plugin.createConversation({
        providerId: this.getActiveProviderId(),
        sessionId,
      });
      state.currentConversationId = conversation.id;
    }

    // Find first user message by role (not by index)
    const firstUserMsg = state.messages.find(m => m.role === 'user');

    if (!firstUserMsg) {
      return;
    }

    const userContent = firstUserMsg.displayContent
      ?? extractUserDisplayContent(firstUserMsg.content)
      ?? firstUserMsg.content;

    // Set immediate fallback title
    const fallbackTitle = conversationController.generateFallbackTitle(userContent);
    await plugin.renameConversation(state.currentConversationId, fallbackTitle);

    if (!plugin.settings.enableAutoTitleGeneration) {
      return;
    }

    // Fire async AI title generation only if service available
    const titleService = this.deps.getTitleGenerationService();
    if (!titleService) {
      // No titleService, just keep the fallback title with no status
      return;
    }

    // Mark as pending only when we're actually starting generation
    await plugin.updateConversation(state.currentConversationId, { titleGenerationStatus: 'pending' });
    conversationController.updateHistoryDropdown();

    const convId = state.currentConversationId;
    const expectedTitle = fallbackTitle; // Store to check if user renamed during generation

    titleService.generateTitle(
      convId,
      userContent,
      async (conversationId, result) => {
        // Check if conversation still exists and user hasn't manually renamed
        const currentConv = await plugin.getConversationById(conversationId);
        if (!currentConv) return;

        // Only apply AI title if user hasn't manually renamed (title still matches fallback)
        const userManuallyRenamed = currentConv.title !== expectedTitle;

        if (result.success && !userManuallyRenamed) {
          await plugin.renameConversation(conversationId, result.title);
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'success' });
        } else if (!userManuallyRenamed) {
          // Keep fallback title, mark as failed (only if user hasn't renamed)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: 'failed' });
        } else {
          // User manually renamed, clear the status (user's choice takes precedence)
          await plugin.updateConversation(conversationId, { titleGenerationStatus: undefined });
        }
        conversationController.updateHistoryDropdown();
      }
    ).catch(() => {
      // Silently ignore title generation errors
    });
  }

  // ============================================
  // Streaming Control
  // ============================================

  cancelStreaming(): void {
    const { state, streamController } = this.deps;
    if (!state.isStreaming) return;
    state.cancelRequested = true;
    // Restore queued message to input instead of discarding
    this.restorePendingMessagesToInput();
    this.getAgentService()?.cancel();
    streamController.hideThinkingIndicator();
  }

  private syncScrollToBottomAfterRenderUpdates(): void {
    const { plugin, state } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    window.requestAnimationFrame(() => {
      if (!(this.deps.plugin.settings.enableAutoScroll ?? true)) return;
      if (!this.deps.state.autoScrollEnabled) return;

      const messagesEl = this.deps.getMessagesEl();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ============================================
  // Instruction Mode
  // ============================================

  async handleInstructionSubmit(rawInstruction: string): Promise<void> {
    const { plugin } = this.deps;

    const instructionRefineService = this.deps.getInstructionRefineService();
    const instructionModeManager = this.deps.getInstructionModeManager();

    if (!instructionRefineService) return;

    const existingPrompt = plugin.settings.systemPrompt;
    let modal: InstructionModal | null = null;
    let wasCancelled = false;

    try {
      modal = new InstructionModal(
        plugin.app,
        rawInstruction,
        {
          onAccept: (finalInstruction) => {
            void (async (): Promise<void> => {
              const currentPrompt = plugin.settings.systemPrompt;
              plugin.settings.systemPrompt = appendMarkdownSnippet(currentPrompt, finalInstruction);
              await plugin.saveSettings();

              new Notice('Instruction added to custom system prompt');
              instructionModeManager?.clear();
            })();
          },
          onReject: () => {
            wasCancelled = true;
            instructionRefineService.cancel();
            instructionModeManager?.clear();
          },
          onClarificationSubmit: async (response) => {
            this.syncInstructionRefineModelOverride(instructionRefineService);
            const result = await instructionRefineService.continueConversation(response);

            if (wasCancelled) {
              return;
            }

            if (!result.success) {
              if (result.error === 'Cancelled') {
                return;
              }
              new Notice(result.error || 'Failed to process response');
              modal?.showError(result.error || 'Failed to process response');
              return;
            }

            if (result.clarification) {
              modal?.showClarification(result.clarification);
            } else if (result.refinedInstruction) {
              modal?.showConfirmation(result.refinedInstruction);
            }
          }
        }
      );
      modal.open();

      this.syncInstructionRefineModelOverride(instructionRefineService);
      instructionRefineService.resetConversation();
      const result = await instructionRefineService.refineInstruction(
        rawInstruction,
        existingPrompt
      );

      if (wasCancelled) {
        return;
      }

      if (!result.success) {
        if (result.error === 'Cancelled') {
          instructionModeManager?.clear();
          return;
        }
        new Notice(result.error || 'Failed to refine instruction');
        modal.showError(result.error || 'Failed to refine instruction');
        instructionModeManager?.clear();
        return;
      }

      if (result.clarification) {
        modal.showClarification(result.clarification);
      } else if (result.refinedInstruction) {
        modal.showConfirmation(result.refinedInstruction);
      } else {
        new Notice('No instruction received');
        modal.showError('No instruction received');
        instructionModeManager?.clear();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      new Notice(`Error: ${errorMsg}`);
      modal?.showError(errorMsg);
      instructionModeManager?.clear();
    }
  }

  // ============================================
  // Approval Dialogs
  // ============================================

  async handleApprovalRequest(
    toolName: string,
    _input: Record<string, unknown>,
    description: string,
    approvalOptions?: ApprovalCallbackOptions,
  ): Promise<ApprovalDecision> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    // Build header element, then detach — InlineAskUserQuestion will re-attach it
    const headerEl = parentEl.createDiv({ cls: 'claudian-ask-approval-info' });
    headerEl.remove();

    const toolEl = headerEl.createDiv({ cls: 'claudian-ask-approval-tool' });
    const iconEl = toolEl.createSpan({ cls: 'claudian-ask-approval-icon' });
    iconEl.setAttribute('aria-hidden', 'true');
    setToolIcon(iconEl, toolName);
    toolEl.createSpan({ text: toolName, cls: 'claudian-ask-approval-tool-name' });

    if (approvalOptions?.decisionReason) {
      headerEl.createDiv({ text: approvalOptions.decisionReason, cls: 'claudian-ask-approval-reason' });
    }
    if (approvalOptions?.blockedPath) {
      headerEl.createDiv({ text: approvalOptions.blockedPath, cls: 'claudian-ask-approval-blocked-path' });
    }
    if (approvalOptions?.agentID) {
      headerEl.createDiv({ text: `Agent: ${approvalOptions.agentID}`, cls: 'claudian-ask-approval-agent' });
    }

    headerEl.createDiv({ text: description, cls: 'claudian-ask-approval-desc' });

    if (this.deps.plugin.settings.diffPreviewBeforeWrites !== false) {
      this.renderApprovalDiffPreview(headerEl, toolName, _input);
    }

    const decisionOptions = approvalOptions?.decisionOptions ?? DEFAULT_APPROVAL_DECISION_OPTIONS;
    const optionDecisionMap = new Map<string, ApprovalDecision>();
    const questionOptions = decisionOptions.map((option, index) => {
      const value = option.value || `approval-option-${index}`;
      if (option.decision) {
        optionDecisionMap.set(value, option.decision);
      }
      return {
        label: option.label,
        description: option.description ?? '',
        value,
      };
    });
    const input = {
      questions: [{
        question: 'Allow this action?',
        options: questionOptions,
        isOther: false,
        isSecret: false,
      }],
    };

    const result = await this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingApprovalInline = inline; },
      undefined,
      { title: 'Permission required', headerEl, showCustomInput: false, immediateSelect: true },
    );

    if (!result) return 'cancel';
    const selected = Object.values(result)[0];
    const selectedValue = Array.isArray(selected) ? selected[0] : selected;
    if (typeof selectedValue !== 'string') {
      new Notice(`Unexpected approval selection: "${String(selectedValue)}"`);
      return 'cancel';
    }

    const decision = optionDecisionMap.get(selectedValue);
    if (decision) {
      return decision;
    }

    return {
      type: 'select-option',
      value: selectedValue,
    };
  }


  private renderApprovalDiffPreview(headerEl: HTMLElement, toolName: string, input: Record<string, unknown>): void {
    const preview = buildDiffPreview(toolName, input);
    if (!preview) return;

    const wrapperEl = headerEl.createDiv({ cls: 'claudian-approval-diff-preview' });
    const titleEl = wrapperEl.createDiv({ cls: 'claudian-approval-diff-title' });
    titleEl.setText(preview.title);

    for (const diff of preview.diffs.slice(0, 3)) {
      const fileEl = wrapperEl.createDiv({ cls: 'claudian-approval-diff-file' });
      fileEl.createSpan({ text: diff.filePath, cls: 'claudian-approval-diff-path' });
      const statsEl = fileEl.createSpan({ cls: 'claudian-approval-diff-stats' });
      renderDiffStats(statsEl, diff.stats);
      const diffEl = wrapperEl.createDiv({ cls: 'claudian-approval-diff-content' });
      renderDiffContent(diffEl, diff.diffLines, 2);
    }

    if (preview.diffs.length > 3) {
      wrapperEl.createDiv({ text: `… ${preview.diffs.length - 3} more file(s)`, cls: 'claudian-approval-diff-more' });
    }
  }

  async handleAskUserQuestion(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, string | string[]> | null> {
    // Auto mode ("double YOLO"): never block on a clarifying prompt — answer with
    // the recommended (first) option for each question so goals run unattended.
    // A loop guard pauses for a human after MAX_AUTO_ANSWERS_BEFORE_PAUSE answers.
    if (this.deps.plugin.settings.autoMode) {
      const auto = resolveAutoQuestionAnswers(input);
      if (auto) {
        const threshold = this.autoModePauseThreshold();
        if (this.autoAnswerStreak >= threshold) {
          // Pause once: reset the budget and fall through to the manual prompt.
          this.autoAnswerStreak = 0;
          await this.deps.streamController.appendText(
            `\n\n⏸️ *Auto-Mode pausiert nach ${threshold} automatischen Antworten — bitte einmal bestätigen.*`,
          );
        } else {
          this.autoAnswerStreak++;
          await this.deps.streamController.appendText(
            `\n\n⚡ *Auto-Mode: ${summarizeAutoAnswers(auto)}*`,
          );
          return auto;
        }
      }
    }

    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    return this.showInlineQuestion(
      parentEl,
      inputContainerEl,
      input,
      (inline) => { this.pendingAskInline = inline; },
      signal,
    );
  }

  private showInlineQuestion(
    parentEl: HTMLElement,
    inputContainerEl: HTMLElement,
    input: Record<string, unknown>,
    setPending: (inline: InlineAskUserQuestion | null) => void,
    signal?: AbortSignal,
    config?: InlineAskQuestionConfig,
  ): Promise<Record<string, string | string[]> | null> {
    this.deps.streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    return new Promise<Record<string, string | string[]> | null>((resolve, reject) => {
      const inline = new InlineAskUserQuestion(
        parentEl,
        input,
        (result: Record<string, string | string[]> | null) => {
          setPending(null);
          this.restoreInputContainer(inputContainerEl);
          resolve(result);
        },
        signal,
        config,
      );
      setPending(inline);
      try {
        inline.render();
      } catch (err) {
        setPending(null);
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  async handleExitPlanMode(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ExitPlanModeDecision | null> {
    // Auto mode: approve the plan immediately and keep executing — no manual gate,
    // unless the loop guard has tripped (then pause once for a human).
    if (this.deps.plugin.settings.autoMode) {
      if (this.autoAnswerStreak < this.autoModePauseThreshold()) {
        this.autoAnswerStreak++;
        await this.deps.streamController.appendText('\n\n⚡ *Auto-Mode: Plan automatisch bestätigt.*');
        return { type: 'approve' };
      }
      this.autoAnswerStreak = 0;
      await this.deps.streamController.appendText(
        '\n\n⏸️ *Auto-Mode pausiert — bitte den Plan einmal bestätigen.*',
      );
    }

    const { state, streamController } = this.deps;
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      throw new Error('Input container is detached from DOM');
    }

    streamController.hideThinkingIndicator();
    this.hideInputContainer(inputContainerEl);

    const enrichedInput = state.planFilePath
      ? { ...input, planFilePath: state.planFilePath }
      : input;

    const renderContent = (el: HTMLElement, markdown: string) =>
      this.deps.renderer.renderContent(el, markdown);

    const planPathPrefix = this.getActiveCapabilities().planPathPrefix;

    return new Promise<ExitPlanModeDecision | null>((resolve, reject) => {
      const inline = new InlineExitPlanMode(
        parentEl,
        enrichedInput,
        (decision: ExitPlanModeDecision | null) => {
          this.pendingExitPlanModeInline = null;
          this.restoreInputContainer(inputContainerEl);
          resolve(decision);
        },
        signal,
        renderContent,
        planPathPrefix,
      );
      this.pendingExitPlanModeInline = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingExitPlanModeInline = null;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  dismissPendingApprovalPrompt(): void {
    if (this.pendingApprovalInline) {
      this.pendingApprovalInline.destroy();
      this.pendingApprovalInline = null;
    }
  }

  dismissPendingApproval(): void {
    this.dismissPendingApprovalPrompt();
    if (this.pendingAskInline) {
      this.pendingAskInline.destroy();
      this.pendingAskInline = null;
    }
    if (this.pendingExitPlanModeInline) {
      this.pendingExitPlanModeInline.destroy();
      this.pendingExitPlanModeInline = null;
    }
    this.dismissPendingPlanApproval(true);
    this.resetInputContainerVisibility();
  }

  private showPlanApproval(): Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }> {
    const inputContainerEl = this.deps.getInputContainerEl();
    const parentEl = inputContainerEl.parentElement;
    if (!parentEl) {
      return Promise.resolve({ decision: null, invalidated: false });
    }

    this.hideInputContainer(inputContainerEl);
    this.pendingPlanApprovalInvalidated = false;

    return new Promise<{ decision: PlanApprovalDecision | null; invalidated: boolean }>((resolve, reject) => {
      const inline = new InlinePlanApproval(
        parentEl,
        (decision: PlanApprovalDecision | null) => {
          const invalidated = this.pendingPlanApprovalInvalidated;
          this.pendingPlanApprovalInvalidated = false;
          this.pendingPlanApproval = null;
          this.restoreInputContainer(inputContainerEl);
          resolve({ decision, invalidated });
        },
      );
      this.pendingPlanApproval = inline;
      try {
        inline.render();
      } catch (err) {
        this.pendingPlanApproval = null;
        this.pendingPlanApprovalInvalidated = false;
        this.restoreInputContainer(inputContainerEl);
        reject(toError(err));
      }
    });
  }

  private dismissPendingPlanApproval(invalidated: boolean): void {
    if (!this.pendingPlanApproval) {
      return;
    }

    if (invalidated) {
      this.pendingPlanApprovalInvalidated = true;
    }
    this.pendingPlanApproval.destroy();
    this.pendingPlanApproval = null;
  }

  private hideInputContainer(inputContainerEl: HTMLElement): void {
    this.inputContainerHideDepth++;
    inputContainerEl.addClass('claudian-hidden');
  }

  private restoreInputContainer(inputContainerEl: HTMLElement): void {
    if (this.inputContainerHideDepth <= 0) return;
    this.inputContainerHideDepth--;
    if (this.inputContainerHideDepth === 0) {
      inputContainerEl.removeClass('claudian-hidden');
    }
  }

  private resetInputContainerVisibility(): void {
    if (this.inputContainerHideDepth > 0) {
      this.inputContainerHideDepth = 0;
      this.deps.getInputContainerEl().removeClass('claudian-hidden');
    }
  }

  // ============================================
  // Built-in Commands
  // ============================================

  private async executeBuiltInCommand(command: BuiltInCommand, args: string): Promise<void> {
    const { conversationController } = this.deps;
    const capabilities = this.getActiveCapabilities();

    if (!isBuiltInCommandSupported(command, capabilities)) {
      new Notice(`/${command.name} is not supported by this provider.`);
      return;
    }

    switch (command.action) {
      case 'clear':
        await conversationController.createNew();
        break;
      case 'add-dir': {
        const externalContextSelector = this.deps.getExternalContextSelector();
        if (!externalContextSelector) {
          new Notice('External context selector not available.');
          return;
        }
        const result = externalContextSelector.addExternalContext(args);
        if (result.success) {
          new Notice(`Added external context: ${result.normalizedPath}`);
        } else {
          new Notice(result.error);
        }
        break;
      }
      case 'resume':
        this.showResumeDropdown();
        break;
      case 'fork': {
        if (!this.getActiveCapabilities().supportsFork) {
          new Notice('Fork is not supported by this provider.');
          return;
        }
        if (!this.deps.onForkAll) {
          new Notice('Fork not available.');
          return;
        }
        await this.deps.onForkAll();
        break;
      }
      case 'goal': {
        const nextGoal = parseGoalArgs(args);
        this.deps.setActiveGoal?.(nextGoal);
        new Notice(nextGoal ? `Goal gesetzt: ${nextGoal}` : 'Goal gelöscht.');
        break;
      }
      case 'workflow': {
        const inputEl = this.deps.getInputEl();
        const [name, ...rest] = args.split(/\s+/).filter(Boolean);
        if (!name) {
          new Notice('Usage: /workflow <name> [args]');
          return;
        }
        const expanded = await this.deps.plugin.expandWorkflow(name, inputEl.value, rest.join(' '));
        if (!expanded) {
          new Notice(`Workflow nicht gefunden: ${name}`);
          return;
        }
        inputEl.value = expanded;
        inputEl.focus();
        this.deps.resetInputHeight();
        new Notice(`Workflow eingefügt: ${name}`);
        break;
      }
      default: {
        // Unknown command - notify user
        const unknownAction = typeof (command as { action?: unknown }).action === 'string'
          ? (command as { action: string }).action
          : 'unknown';
        new Notice(`Unknown command: ${unknownAction}`);
        break;
      }
    }
  }

  // ============================================
  // Resume Session Dropdown
  // ============================================

  handleResumeKeydown(e: KeyboardEvent): boolean {
    if (!this.activeResumeDropdown?.isVisible()) return false;
    return this.activeResumeDropdown.handleKeydown(e);
  }

  isResumeDropdownVisible(): boolean {
    return this.activeResumeDropdown?.isVisible() ?? false;
  }

  destroyResumeDropdown(): void {
    if (this.activeResumeDropdown) {
      this.activeResumeDropdown.destroy();
      this.activeResumeDropdown = null;
    }
  }

  private showResumeDropdown(): void {
    const { plugin, state, conversationController } = this.deps;

    // Clean up any existing dropdown
    this.destroyResumeDropdown();

    const conversations = plugin.getConversationList();
    if (conversations.length === 0) {
      new Notice('No conversations to resume');
      return;
    }

    const openConversation = this.deps.openConversation
      ?? ((id: string) => conversationController.switchTo(id));

    this.activeResumeDropdown = new ResumeSessionDropdown(
      this.deps.getInputContainerEl(),
      this.deps.getInputEl(),
      conversations,
      state.currentConversationId,
      {
        onSelect: (id) => {
          this.destroyResumeDropdown();
          openConversation(id).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            new Notice(`Failed to open conversation: ${msg}`);
          });
        },
        onDismiss: () => {
          this.destroyResumeDropdown();
        },
      }
    );
  }
}
