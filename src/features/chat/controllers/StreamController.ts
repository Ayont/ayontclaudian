import { setIcon, TFile } from 'obsidian';

import { recordProviderError } from '../../../core/diagnostics/errorHistory';
import { providerErrorRecoveryService } from '../../../core/diagnostics/errorRecovery';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import {
  DEFAULT_CHAT_PROVIDER_ID,
  type ProviderId,
  type ProviderSubagentLifecycleAdapter,
} from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import { type BrowserActivity, resolveBrowserActivity } from '../../../core/tools/browserActivity';
import { parseTodoInput } from '../../../core/tools/todo';
import { extractResolvedAnswers, extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import {
  isEditTool,
  isSubagentToolName,
  isWriteEditTool,
  skipsBlockedDetection,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_ASK_USER_QUESTION,
  TOOL_TASK,
  TOOL_TODO_WRITE,
  TOOL_WRITE,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type {
  ChatMessage,
  ContentBlock,
  OutputSurface,
  StreamChunk,
  SubagentInfo,
  ToolCallInfo,
} from '../../../core/types';
import type { SDKToolUseResult } from '../../../core/types/diff';
import type ClaudianPlugin from '../../../main';
import { isBenignSdkDiagnostic } from '../../../providers/claude/stream/transformClaudeMessage';
import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import { formatDurationMmSs } from '../../../utils/date';
import { extractDiffData } from '../../../utils/diff';
import { createInlineThinkScrubber } from '../../../utils/inlineThinkScrubber';
import { hasOpenCodeFence, hasStreamingMathDelimiters } from '../../../utils/markdownMath';
import { getVaultPath, normalizePathForVault } from '../../../utils/path';
import { FLAVOR_TEXTS } from '../constants';
import {
  buildActivityLabels,
  foldDownActivity,
  unfoldActivity,
} from '../rendering/activityFold';
import type { MessageRenderer, RenderContentOptions } from '../rendering/MessageRenderer';
import {
  resolveRichOutputSurface,
  shouldContinueRichOutputAcrossTool,
  splitCompletedRichOutput,
} from '../rendering/RichOutputFences';
import { resolveSubagentLifecycleAdapter } from '../rendering/subagentLifecycleResolution';
import {
  createSubagentBlock,
  finalizeSubagentBlock,
  type SubagentState,
} from '../rendering/SubagentRenderer';
import {
  createThinkingBlock,
  finalizeThinkingBlock,
} from '../rendering/ThinkingBlockRenderer';
import {
  getToolName,
  getToolSummary,
  isBlockedToolResult,
  renderToolCall,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import {
  createWriteEditBlock,
  finalizeWriteEditBlock,
  updateWriteEditWithDiff,
} from '../rendering/WriteEditRenderer';
import type { SubagentManager } from '../services/SubagentManager';
import type { ChatState } from '../state/ChatState';
import type { FileContextManager } from '../ui/FileContext';

export interface StreamControllerDeps {
  plugin: ClaudianPlugin;
  state: ChatState;
  renderer: MessageRenderer;
  subagentManager: SubagentManager;
  getMessagesEl: () => HTMLElement;
  getFileContextManager: () => FileContextManager | null;
  updateQueueIndicator: () => void;
  /** Get the agent service from the tab. */
  getAgentService?: () => ChatRuntime | null;
  /** Update the compact live status bar with the latest visible activity. */
  updateLiveActivity?: (activity: { primary: string; meta?: string; phrase?: string }) => void;
  /** Surface a browser/desktop automation step in the live status bar. */
  updateBrowserActivity?: (activity: BrowserActivity) => void;
}

/**
 * Adaptive frame budget for all streaming providers. Markdown rendering is
 * cumulative, so a long response must render less often than short token
 * bursts to avoid O(n²)-like DOM churn while still feeling immediate.
 *
 * This is only the floor — see {@link getRenderBudgetDelay}.
 */
export function getAdaptiveStreamRenderDelay(contentLength: number, isDocumentVisible = true): number {
  if (!isDocumentVisible) return 250;
  if (contentLength < 8_000) return 16;
  if (contentLength < 32_000) return 48;
  if (contentLength < 100_000) return 96;
  return 160;
}

/**
 * Share of wall-clock time streaming renders are allowed to occupy. At 0.5 a
 * render that cost 90ms buys a 90ms gap before the next one starts.
 */
const STREAM_RENDER_DUTY_CYCLE = 0.5;

/**
 * Upper bound on the backoff. Without it a single pathological render (a huge
 * table, a cold syntax-highlighter load) would stall the next update for
 * seconds and the answer would look frozen.
 */
const MAX_STREAM_RENDER_DELAY_MS = 400;

/**
 * Frame delay that keeps streaming renders inside their time budget.
 *
 * `renderContent` tears the block down and re-renders the *entire* accumulated
 * Markdown on every frame, so the cost of one frame grows with the answer while
 * the number of frames grows too. The length table above approximates that, but
 * it cannot see what the content actually costs: a 30K answer of prose and a
 * 30K answer of syntax-highlighted code differ by an order of magnitude, and so
 * do a fast desktop and a loaded laptop.
 *
 * Feeding the measured duration of the previous render back in fixes both. The
 * next frame is scheduled so rendering occupies at most
 * {@link STREAM_RENDER_DUTY_CYCLE} of wall clock — the work is self-limiting
 * however long the answer grows, and short cheap renders still run at the
 * length-based floor so short answers stay frame-fast.
 *
 * @param floorMs        Length-based minimum from {@link getAdaptiveStreamRenderDelay}.
 * @param lastRenderMs   Duration of the previous render, or null before one ran.
 */
export function getRenderBudgetDelay(floorMs: number, lastRenderMs: number | null): number {
  if (lastRenderMs === null || !Number.isFinite(lastRenderMs) || lastRenderMs <= 0) {
    return floorMs;
  }

  const budgeted = Math.round(lastRenderMs * (1 / STREAM_RENDER_DUTY_CYCLE - 1));
  return Math.min(MAX_STREAM_RENDER_DELAY_MS, Math.max(floorMs, budgeted));
}

export class StreamController {
  private static readonly ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS = [200, 600, 1500] as const;

  private deps: StreamControllerDeps;
  private pendingTextRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingTextRenderPromise: Promise<void> | null = null;
  private resolvePendingTextRender: (() => void) | null = null;
  private isTextRenderRunning = false;
  private pendingThinkingRenderFrame: ScheduledAnimationFrame | null = null;
  private pendingThinkingRenderPromise: Promise<void> | null = null;
  private resolvePendingThinkingRender: (() => void) | null = null;
  private isThinkingRenderRunning = false;
  private pendingToolOutputFrames = new Map<string, ScheduledAnimationFrame>();
  private pendingScrollFrame: ScheduledAnimationFrame | null = null;
  /** Assistant message whose explicit final usage report was already budgeted. */
  private finalUsageMessageId: string | null = null;
  /** Text block held open while a rich fence is interrupted by tool events. */
  private activeRichTextBlock: Extract<ContentBlock, { type: 'text' }> | null = null;
  private activeRichMessageId: string | null = null;
  private currentTextOutputSurface: OutputSurface | undefined;
  private inlineThinkScrubber = createInlineThinkScrubber();

  // Smoothed cost of the last text/thinking render, feeding getRenderBudgetDelay.
  // Tracked separately because a thinking block and an answer block rarely cost
  // the same, and one expensive block should not throttle the other.
  private textRenderCostMs: number | null = null;
  private thinkingRenderCostMs: number | null = null;

  // Provider lifecycle agent tracking (spawn → wait/close lifecycle)
  private lifecycleSubagentStates = new Map<string, SubagentState>(); // spawn callId → SubagentState
  private lifecycleAgentIdToSpawnId = new Map<string, string>();      // agentId → spawn callId

  constructor(deps: StreamControllerDeps) {
    this.deps = deps;
  }

  /**
   * Reports a pre-flight phase before the provider can emit stream chunks.
   * This keeps the same transparent activity surface for vault preparation,
   * cold runtime startup and the actual model stream.
   */
  reportLiveActivity(activity: { primary: string; meta?: string; phrase?: string }): void {
    this.deps.updateLiveActivity?.(activity);
  }

  private getActiveProviderId(): ProviderId {
    return this.deps.getAgentService?.()?.providerId ?? DEFAULT_CHAT_PROVIDER_ID;
  }

  private getSubagentLifecycleAdapter(toolName?: string): ProviderSubagentLifecycleAdapter | null {
    return resolveSubagentLifecycleAdapter(this.getActiveProviderId(), toolName);
  }

  private normalizeToolResultContent(content: unknown): string {
    return extractToolResultContent(content, { fallbackIndent: 2 });
  }

  // ============================================
  // Stream Chunk Handling
  // ============================================

  async handleStreamChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    // Reasoning leaked into the text channel as <think>…</think> (OpenAI-
    // compatible gateways behind Kimi / dsh / Freebuff / vibe / pi) is routed to
    // the thinking block. Delta-safe: split tags are held until they resolve.
    if (chunk.type === 'text') {
      const parts = this.inlineThinkScrubber.feed(chunk.content);
      for (const part of parts) {
        await this.handleScrubbedChunk(
          part.kind === 'thinking'
            ? { type: 'thinking', content: part.content }
            : { type: 'text', content: part.content },
          msg,
        );
      }
      return;
    }
    if (chunk.type === 'done') {
      for (const part of this.inlineThinkScrubber.flush()) {
        await this.handleScrubbedChunk(
          part.kind === 'thinking'
            ? { type: 'thinking', content: part.content }
            : { type: 'text', content: part.content },
          msg,
        );
      }
    }
    await this.handleScrubbedChunk(chunk, msg);
  }

  private async handleScrubbedChunk(chunk: StreamChunk, msg: ChatMessage): Promise<void> {
    const { state } = this.deps;

    switch (chunk.type) {
      case 'thinking':
        this.deps.updateLiveActivity?.({
          primary: 'Modell denkt nach',
          meta: 'Thinking-Stream',
          phrase: 'reasoning',
        });
        // Flush pending tools before rendering new content type
        this.flushPendingTools();
        // Some providers deliver reasoning out of band (Antigravity's planner
        // row lands via the transcript while stream-json is mid-answer). If the
        // open text block is inside a code fence, closing it here would split
        // the fence into two broken blocks — keep it open; the thinking block
        // is rendered after it and the next text delta continues the fence.
        if (state.currentTextEl && !hasOpenCodeFence(state.currentTextContent)) {
          await this.finalizeCurrentTextBlock(msg, { preserveRichOutput: true });
        }
        await this.appendThinking(chunk.content);
        break;

      case 'text':
        this.deps.updateLiveActivity?.({
          primary: 'Schreibe Antwort',
          meta: 'Antwort-Stream',
          phrase: 'writing',
        });
        // Flush pending tools before rendering new content type
        this.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        msg.content += chunk.content;
        await this.appendText(chunk.content, msg.outputSurface);
        break;

      case 'tool_use': {
        const browserActivity = resolveBrowserActivity(chunk.name, chunk.input);
        this.deps.updateLiveActivity?.({
          primary: getToolName(chunk.name, chunk.input),
          meta: getToolSummary(chunk.name, chunk.input) || 'Tool-Aufruf gestartet',
          phrase: browserActivity
            ? (browserActivity.kind === 'desktop' ? 'steuert Desktop' : 'steuert Browser')
            : 'running tool',
        });
        if (browserActivity) {
          this.deps.updateBrowserActivity?.(browserActivity);
        }
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg, { preserveRichOutput: true });

        if (isSubagentToolName(chunk.name)) {
          // Flush pending tools before Agent
          this.flushPendingTools();
          this.handleTaskToolUseViaManager(chunk, msg);
          break;
        }

        if (chunk.name === TOOL_AGENT_OUTPUT) {
          this.handleAgentOutputToolUse(chunk, msg);
          break;
        }

        const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(chunk.name);
        if (subagentLifecycleAdapter?.isSpawnTool(chunk.name)) {
          this.handleProviderSubagentSpawn(chunk, msg, subagentLifecycleAdapter);
          break;
        }
        if (subagentLifecycleAdapter?.isHiddenTool(chunk.name)) {
          this.handleProviderHiddenSubagentTool(chunk, msg);
          break;
        }

        this.handleRegularToolUse(chunk, msg);
        break;
      }

      case 'tool_result': {
        this.deps.updateLiveActivity?.({
          primary: 'Tool-Ergebnis erhalten',
          meta: chunk.isError ? 'Tool meldet einen Fehler' : 'Tool abgeschlossen',
          phrase: chunk.isError ? 'checking error' : 'reading output',
        });
        await this.handleToolResult(chunk, msg);
        break;
      }

      case 'subagent_tool_use':
      case 'subagent_tool_result':
        this.deps.updateLiveActivity?.({
          primary: chunk.type === 'subagent_tool_use' ? chunk.name : 'Subagent-Tool-Ergebnis',
          meta: `Subagent ${chunk.subagentId}`,
          phrase: 'agent swarm',
        });
        await this.handleSubagentChunk(chunk, msg);
        break;

      case 'async_subagent_result':
        await this.handleAsyncSubagentResult(chunk);
        break;

      case 'background_task_started':
        this.deps.subagentManager.handleWorkflowTaskStarted(chunk);
        this.deps.updateLiveActivity?.({
          primary: chunk.workflowName ? `Workflow: ${chunk.workflowName}` : chunk.description,
          meta: 'Workflow gestartet',
          phrase: 'orchestrating workflow',
        });
        this.showThinkingIndicator();
        break;

      case 'background_task_progress':
        this.deps.subagentManager.handleWorkflowTaskProgress(chunk);
        this.deps.updateLiveActivity?.({
          primary: chunk.summary || chunk.description,
          meta: `${chunk.usage.toolUses} tools · ${chunk.usage.totalTokens.toLocaleString()} tokens`,
          phrase: 'workflow running',
        });
        break;

      case 'background_task_result':
        this.deps.subagentManager.handleWorkflowTaskResult(chunk);
        this.deps.updateLiveActivity?.({
          primary: chunk.status === 'completed' ? 'Workflow abgeschlossen' : 'Workflow gestoppt',
          meta: chunk.summary || `Task ${chunk.taskId}`,
          phrase: chunk.status === 'completed' ? 'continuing automatically' : 'workflow ended',
        });
        if (chunk.status === 'completed') this.showThinkingIndicator();
        break;

      case 'tool_output':
        this.handleToolOutput(chunk, msg);
        break;

      case 'notice':
        if (chunk.level === 'warning' && chunk.content.startsWith('Speed-Limit')) {
          this.deps.plugin.getView()?.getActiveTab()?.ui.serviceTierToggle?.setRuntimeState('cooldown');
        }
        this.deps.updateLiveActivity?.({
          primary: chunk.level === 'warning' ? 'Provider-Warnung' : 'Provider-Hinweis',
          meta: chunk.content,
          phrase: 'needs attention',
        });
        this.flushPendingTools();
        // Finalize the preceding text so the notice lands in its OWN block and
        // renders as a standalone status card (see MessageRenderer.renderContent).
        await this.finalizeCurrentTextBlock(msg);
        await this.appendText(`⚠️ **${chunk.level === 'warning' ? 'Blocked' : 'Notice'}:** ${chunk.content}`);
        break;

      case 'error': {
        if (isBenignSdkDiagnostic(chunk.content)) {
          break;
        }
        const providerId = this.getActiveProviderId();
        this.deps.updateLiveActivity?.({
          primary: 'Provider-Fehler',
          meta: chunk.content,
          phrase: 'error',
        });
        recordProviderError(providerId, chunk.content);
        providerErrorRecoveryService.recordError(providerId, new Error(chunk.content));
        // Flush pending tools before rendering error message
        this.flushPendingTools();
        // Finalize the preceding text so the error lands in its OWN block and
        // renders as a standalone status card (see MessageRenderer.renderContent).
        await this.finalizeCurrentTextBlock(msg);
        await this.appendText(`❌ **Error:** ${chunk.content}`);
        break;
      }

      case 'done':
        // Flush any remaining pending tools
        this.flushPendingTools();
        if (state.currentContentEl) {
          this.foldPrecedingActivity(state.currentContentEl, msg);
        }
        break;

      case 'context_compacted': {
        this.flushPendingTools();
        if (state.currentThinkingState) {
          await this.finalizeCurrentThinkingBlock(msg);
        }
        await this.finalizeCurrentTextBlock(msg);
        msg.contentBlocks = msg.contentBlocks || [];
        msg.contentBlocks.push({ type: 'context_compacted' });
        this.renderCompactBoundary();
        break;
      }

      case 'usage': {
        // Skip usage updates from other sessions or when flagged (during session reset)
        const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
        const chunkSessionId = chunk.sessionId ?? null;
        if (
          (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
          (chunkSessionId && !currentSessionId)
        ) {
          break;
        }
        if (!state.ignoreUsageUpdates) {
          const activeModel = this.getActiveProviderModel();
          const reportedUsage = activeModel && !chunk.usage.model
            ? { ...chunk.usage, model: activeModel }
            : chunk.usage;
          if (chunk.contextDisplay !== 'preserve') {
            state.usage = reportedUsage;
          }
          // Snapshots update the context meter only. Explicit final reports are
          // idempotent per assistant message; deltas and legacy single reports
          // remain additive. Claude's older restatement flag maps to snapshot
          // semantics until its provider contract migrates to `reportType`.
          const isSnapshot = reportedUsage.reportType === 'snapshot'
            || reportedUsage.isRestatedSnapshot === true;
          const isDuplicateFinal = reportedUsage.reportType === 'final'
            && this.finalUsageMessageId === msg.id;
          if (!isSnapshot && !isDuplicateFinal) {
            this.deps.plugin.tokenBudgetTracker?.trackUsage(reportedUsage, this.getActiveProviderId());
            this.deps.plugin.persistTokenUsage?.();
            if (reportedUsage.reportType === 'final') {
              this.finalUsageMessageId = msg.id;
            }
          }
        }
        break;
      }

      default:
        break;
    }

    this.scrollToBottom();
  }

  // ============================================
  // Tool Use Handling
  // ============================================

  /**
   * Handles regular tool_use chunks by buffering them.
   * Tools are rendered when flushPendingTools is called (on next content type or tool_result).
   */
  private handleRegularToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state } = this.deps;

    // Check if this is an update to an existing tool call
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (existingToolCall) {
      const newInput = chunk.input || {};
      if (Object.keys(newInput).length > 0) {
        existingToolCall.input = { ...existingToolCall.input, ...newInput };

        // Re-parse TodoWrite on input updates (streaming may complete the input)
        if (existingToolCall.name === TOOL_TODO_WRITE) {
          const todos = parseTodoInput(existingToolCall.input);
          if (todos) {
            this.deps.state.currentTodos = todos;
          }
        }

        // Capture plan file path on input updates (file_path may arrive in a later chunk)
        if (existingToolCall.name === TOOL_WRITE) {
          this.capturePlanFilePath(existingToolCall.input);
        }

        // If already rendered, update the header name + summary
        const toolEl = state.toolCallElements.get(chunk.id);
        if (toolEl) {
          const nameEl = toolEl.querySelector('.claudian-tool-name')
            ?? toolEl.querySelector('.claudian-write-edit-name');
          if (nameEl) {
            nameEl.setText(getToolName(existingToolCall.name, existingToolCall.input));
          }
          const summaryEl = toolEl.querySelector('.claudian-tool-summary')
            ?? toolEl.querySelector('.claudian-write-edit-summary');
          if (summaryEl) {
            summaryEl.setText(getToolSummary(existingToolCall.name, existingToolCall.input));
          }
        }
        // If still pending, the updated input is already in the toolCall object
      }
      return;
    }

    // TodoWrite: update panel state immediately (side effect).
    if (chunk.name === TOOL_TODO_WRITE) {
      const todos = parseTodoInput(chunk.input);
      if (todos) {
        this.deps.state.currentTodos = todos;
      }
      // Kimi synthesizes TodoWrite events purely to drive the status panel;
      // skip the inline tool card so the chat stream stays clean.
      if (chunk.input?.__panelOnly === true) {
        return;
      }
    }

    // Create new tool call
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);

    // Add to contentBlocks for ordering
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    // Track Write to provider plan directory for plan mode (used by approve-new-session)
    if (chunk.name === TOOL_WRITE) {
      this.capturePlanFilePath(chunk.input);
    }

    // Buffer the tool call instead of rendering immediately
    if (state.currentContentEl) {
      state.pendingTools.set(chunk.id, {
        toolCall,
        parentEl: state.currentContentEl,
      });
      this.showThinkingIndicator();
    }
  }

  private getActiveProviderModel(): string | undefined {
    const providerId = this.deps.getAgentService?.()?.providerId;
    if (!providerId) {
      return undefined;
    }

    const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.deps.plugin.settings,
      providerId,
    );
    return typeof settings.model === 'string' ? settings.model : undefined;
  }

  private shouldDeferMathRendering(): boolean {
    return this.deps.plugin.settings.deferMathRenderingDuringStreaming !== false;
  }

  private shouldExpandFileEditsByDefault(): boolean {
    return this.deps.plugin.settings.expandFileEditsByDefault === true;
  }

  private getStreamingRenderOptions(
    content: string,
    outputSurface = this.currentTextOutputSurface,
  ): RenderContentOptions | undefined {
    const deferMath = this.shouldDeferMathRendering() && hasStreamingMathDelimiters(content);
    const richSurface = outputSurface && outputSurface !== 'chat' ? outputSurface : undefined;
    if (!deferMath && !richSurface) return undefined;
    return {
      ...(deferMath ? { deferMath: true } : {}),
      ...(richSurface ? { outputSurface: richSurface } : {}),
    };
  }

  private capturePlanFilePath(input: Record<string, unknown>): void {
    const filePath = input.file_path as string | undefined;
    if (!filePath) return;

    const planPathPrefix = this.deps.getAgentService?.()?.getCapabilities().planPathPrefix;
    if (planPathPrefix && filePath.replace(/\\/g, '/').includes(planPathPrefix)) {
      this.deps.state.planFilePath = filePath;
    }
  }

  /**
   * Flushes all pending tool calls by rendering them.
   * Called when a different content type arrives or stream ends.
   */
  private flushPendingTools(): void {
    const { state } = this.deps;

    if (state.pendingTools.size === 0) {
      return;
    }

    // Render pending tools in order (Map preserves insertion order)
    for (const toolId of state.pendingTools.keys()) {
      this.renderPendingTool(toolId);
    }

    state.pendingTools.clear();
  }

  /**
   * Renders a single pending tool call and moves it from pending to rendered state.
   */
  private renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending) return;

    const { toolCall, parentEl } = pending;
    if (!parentEl) return;
    if (isWriteEditTool(toolCall.name)) {
      const writeEditState = createWriteEditBlock(parentEl, toolCall, {
        initiallyExpanded: this.shouldExpandFileEditsByDefault(),
      });
      state.writeEditStates.set(toolId, writeEditState);
      state.toolCallElements.set(toolId, writeEditState.wrapperEl);
    } else {
      renderToolCall(parentEl, toolCall, state.toolCallElements, {
        initiallyExpanded: toolCall.name === TOOL_APPLY_PATCH && this.shouldExpandFileEditsByDefault(),
      });
    }
    state.pendingTools.delete(toolId);
  }

  private handleToolOutput(
    chunk: { type: 'tool_output'; id: string; content: string },
    msg: ChatMessage,
  ): void {
    const { state } = this.deps;

    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) {
      return;
    }

    existingToolCall.result = (existingToolCall.result ?? '') + chunk.content;
    this.scheduleToolOutputRender(chunk.id, existingToolCall);
    this.showThinkingIndicator();
  }

  // ============================================
  // Provider lifecycle subagents (spawn → wait/close)
  // ============================================

  private handleProviderSubagentSpawn(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage,
    adapter: ProviderSubagentLifecycleAdapter,
  ): void {
    const { state } = this.deps;

    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
    msg.contentBlocks = msg.contentBlocks || [];
    msg.contentBlocks.push({ type: 'tool_use', toolId: chunk.id });

    // Render as subagent block immediately
    if (state.currentContentEl) {
      this.flushPendingTools();
      const subagentInfo = adapter.buildSubagentInfo(toolCall, msg.toolCalls);

      const subagentState = createSubagentBlock(state.currentContentEl, chunk.id, {
        description: subagentInfo.description,
        prompt: subagentInfo.prompt,
      });
      this.lifecycleSubagentStates.set(chunk.id, subagentState);
    }
  }

  private handleProviderHiddenSubagentTool(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    // Track in toolCalls for data completeness, but don't create DOM or content block
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(toolCall);
  }

  /**
   * Handles tool_result for provider lifecycle subagent tools.
   * Returns true if the result was consumed (caller should return early).
   */
  private handleProviderSubagentResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean },
    msg: ChatMessage
  ): boolean {
    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);
    if (!existingToolCall) return false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    const adapter = this.getSubagentLifecycleAdapter(existingToolCall.name);
    if (!adapter) return false;

    if (adapter.isSpawnTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;

      const spawnResult = adapter.extractSpawnResult(normalizedContent);
      if (spawnResult.agentId) {
        this.lifecycleAgentIdToSpawnId.set(spawnResult.agentId, chunk.id);
      }

      const subagentInfo = adapter.buildSubagentInfo(existingToolCall, msg.toolCalls ?? []);
      const subagentState = this.lifecycleSubagentStates.get(chunk.id);
      if (subagentState) {
        subagentState.info.description = subagentInfo.description;
        subagentState.info.prompt = subagentInfo.prompt;
        subagentState.labelEl.setText(
          subagentInfo.description.length > 40
            ? subagentInfo.description.substring(0, 40) + '...'
            : subagentInfo.description
        );
      }

      if (chunk.isError) {
        if (subagentState) {
          finalizeSubagentBlock(subagentState, normalizedContent || 'Error', true);
        }
      }
      return true;
    }

    if (adapter.isWaitTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;

      for (const spawnId of adapter.resolveSpawnToolIds(
        existingToolCall,
        this.lifecycleAgentIdToSpawnId,
      )) {
        const spawnToolCall = msg.toolCalls?.find(tc => tc.id === spawnId);
        const subagentState = this.lifecycleSubagentStates.get(spawnId);
        if (!spawnToolCall || !subagentState) continue;

        const subagentInfo = adapter.buildSubagentInfo(spawnToolCall, msg.toolCalls ?? []);
        subagentState.info.description = subagentInfo.description;
        subagentState.info.prompt = subagentInfo.prompt;

        if (subagentInfo.status === 'completed' || subagentInfo.status === 'error') {
          finalizeSubagentBlock(
            subagentState,
            subagentInfo.result || (subagentInfo.status === 'error' ? 'Error' : 'DONE'),
            subagentInfo.status === 'error'
          );
        }
      }
      return true;
    }

    if (adapter.isCloseTool(existingToolCall.name)) {
      existingToolCall.status = chunk.isError ? 'error' : 'completed';
      existingToolCall.result = normalizedContent;
      return true;
    }

    return false;
  }

  private async handleToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
    msg: ChatMessage
  ): Promise<void> {
    const { state, subagentManager } = this.deps;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);

    // Resolve pending Task before processing result.
    if (subagentManager.hasPendingTask(chunk.id)) {
      this.renderPendingTaskFromTaskResultViaManager(chunk, msg);
    }

    // Check if it's a sync subagent result
    const subagentState = subagentManager.getSyncSubagent(chunk.id);
    if (subagentState) {
      this.finalizeSubagent(chunk, msg);
      return;
    }

    // Check if it's an async task result
    if (this.handleAsyncTaskToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if it's an agent output result
    if (await this.handleAgentOutputToolResult(chunk)) {
      this.showThinkingIndicator();
      return;
    }

    if (this.handleProviderSubagentResult(chunk, msg)) {
      this.showThinkingIndicator();
      return;
    }

    // Check if tool is still pending (buffered) - render it now before applying result
    if (state.pendingTools.has(chunk.id)) {
      this.renderPendingTool(chunk.id);
    }

    const existingToolCall = msg.toolCalls?.find(tc => tc.id === chunk.id);

    // Regular tool result
    const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);

    if (existingToolCall) {
      // Tools that resolve via dedicated callbacks (not content-based) skip
      // blocked detection — their status is determined solely by isError
      if (chunk.isError) {
        existingToolCall.status = 'error';
      } else if (!skipsBlockedDetection(existingToolCall.name) && isBlocked) {
        existingToolCall.status = 'blocked';
      } else {
        existingToolCall.status = 'completed';
      }
      existingToolCall.result = normalizedContent;

      if (existingToolCall.name === TOOL_ASK_USER_QUESTION) {
        const answers =
          extractResolvedAnswers(chunk.toolUseResult) ??
          extractResolvedAnswersFromResultText(normalizedContent);
        if (answers) existingToolCall.resolvedAnswers = answers;
      }

      const writeEditState = state.writeEditStates.get(chunk.id);
      if (writeEditState && isWriteEditTool(existingToolCall.name)) {
        if (!chunk.isError && !isBlocked) {
          const diffData = extractDiffData(chunk.toolUseResult, existingToolCall);
          if (diffData) {
            existingToolCall.diffData = diffData;
            updateWriteEditWithDiff(writeEditState, diffData);
          }
        }
        finalizeWriteEditBlock(writeEditState, chunk.isError || isBlocked);
      } else {
        this.cancelPendingToolOutputRender(chunk.id);
        updateToolCallResult(chunk.id, existingToolCall, state.toolCallElements);
      }

      // Notify Obsidian vault so the file tree refreshes after Write/Edit/NotebookEdit
      if (!chunk.isError && !isBlocked && isEditTool(existingToolCall.name)) {
        this.notifyVaultFileChange(existingToolCall.input);
      }

      // Runtime apply_patch: refresh each changed file path
      if (!chunk.isError && !isBlocked && existingToolCall.name === TOOL_APPLY_PATCH) {
        this.notifyApplyPatchFileChanges(existingToolCall.input);
      }
    }

    this.showThinkingIndicator();
  }

  foldPrecedingActivity(contentEl: HTMLElement, msg?: ChatMessage): void {
    const activityEls: HTMLElement[] = [];
    for (let i = 0; i < contentEl.children.length; i++) {
      const child = contentEl.children[i] as HTMLElement;
      if (!child) continue;
      if (
        child.classList.contains('claudian-tool-run-group') ||
        child.classList.contains('claudian-activity-fold') ||
        child.classList.contains('claudian-text-block') ||
        child.classList.contains('claudian-compact-boundary')
      ) {
        continue;
      }
      if (
        child.classList.contains('claudian-tool-call') ||
        child.classList.contains('claudian-write-edit-block') ||
        child.classList.contains('claudian-subagent') ||
        child.classList.contains('claudian-thinking-block')
      ) {
        activityEls.push(child);
      }
    }

    if (activityEls.length === 0) return;

    const hasTools = activityEls.some(el =>
      el.classList.contains('claudian-tool-call') ||
      el.classList.contains('claudian-write-edit-block') ||
      el.classList.contains('claudian-subagent')
    );
    if (!hasTools && activityEls.length < 2) return;

    const firstEl = activityEls[0];
    const groupEl = contentEl.createEl('details', { cls: 'claudian-tool-run-group claudian-activity-fold' });
    groupEl.open = true;
    contentEl.insertBefore(groupEl, firstEl);

    const summaryEl = groupEl.createEl('summary', { cls: 'claudian-tool-run-summary claudian-activity-summary' });
    const iconEl = summaryEl.createSpan({ cls: 'claudian-tool-run-icon claudian-activity-icon' });
    iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z"/></svg>';

    const totalCount = activityEls.length;
    const toolsCount = activityEls.filter(el => !el.classList.contains('claudian-thinking-block')).length;
    const thoughtsCount = activityEls.filter(el => el.classList.contains('claudian-thinking-block')).length;
    const isWorkMode = Boolean(contentEl.closest('.claudian-mode-work'));

    const distinctNames = msg?.toolCalls?.map(tc => tc.name) ?? [];
    const labels = buildActivityLabels(totalCount, toolsCount, thoughtsCount, distinctNames, undefined, isWorkMode);
    const titleEl = summaryEl.createSpan({ cls: 'claudian-tool-run-title claudian-activity-title' });
    titleEl.createSpan({ text: labels.title });
    if (labels.breakdown) {
      titleEl.createSpan({
        cls: 'claudian-tool-run-breakdown claudian-activity-breakdown',
        text: labels.breakdown,
      });
    }

    const statusEl = summaryEl.createSpan({ cls: 'claudian-tool-run-status claudian-activity-status' });
    setIcon(statusEl, 'check');

    const chevronEl = summaryEl.createSpan({ cls: 'claudian-tool-run-chevron claudian-activity-chevron' });
    setIcon(chevronEl, 'chevron-down');

    const bodyEl = groupEl.createDiv({ cls: 'claudian-tool-run-body claudian-activity-body' });
    for (const el of activityEls) {
      bodyEl.appendChild(el);
    }

    summaryEl.addEventListener('click', (e) => {
      e.preventDefault();
      if (groupEl.open) {
        foldDownActivity(groupEl);
      } else {
        unfoldActivity(groupEl);
      }
    });

    foldDownActivity(groupEl);
  }

  // ============================================
  // Text Block Management
  // ============================================

  async appendText(text: string, outputSurface?: OutputSurface): Promise<void> {
    const { state } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();

    if (!state.currentTextEl) {
      this.foldPrecedingActivity(state.currentContentEl);
      state.currentTextEl = state.currentContentEl.createDiv({ cls: 'claudian-text-block' });
      state.currentTextContent = '';
      this.currentTextOutputSurface = outputSurface;
    } else if (!this.currentTextOutputSurface && outputSurface) {
      this.currentTextOutputSurface = outputSurface;
    }

    state.currentTextContent += text;
    void this.scheduleCurrentTextRender();
  }

  async finalizeCurrentTextBlock(
    msg?: ChatMessage,
    options?: { preserveRichOutput?: boolean },
  ): Promise<void> {
    const { state, renderer } = this.deps;
    await this.flushPendingTextRender();
    if (state.currentContentEl) {
      this.foldPrecedingActivity(state.currentContentEl, msg);
    }

    if (msg && state.currentTextContent) {
      const requestedOutputSurface = this.currentTextOutputSurface ?? msg.outputSurface;
      if (
        state.currentTextEl
        && this.shouldDeferMathRendering()
        && hasStreamingMathDelimiters(state.currentTextContent)
      ) {
        if (requestedOutputSurface && requestedOutputSurface !== 'chat') {
          await renderer.renderContent(
            state.currentTextEl,
            state.currentTextContent,
            { outputSurface: requestedOutputSurface },
          );
        } else {
          await renderer.renderContent(state.currentTextEl, state.currentTextContent);
        }
      }
      const resolvedSurface = resolveRichOutputSurface(
        state.currentTextContent,
        requestedOutputSurface,
      );
      const canReuseActiveBlock = this.activeRichTextBlock
        && this.activeRichMessageId === msg.id;
      const completedSplit = canReuseActiveBlock && resolvedSurface
        ? splitCompletedRichOutput(state.currentTextContent, resolvedSurface)
        : null;
      const hasOrderedRemainder = completedSplit?.remainder.trim().length
        ? true
        : false;
      const semanticContent = hasOrderedRemainder
        ? completedSplit!.semanticContent
        : state.currentTextContent;
      let textBlock: Extract<ContentBlock, { type: 'text' }>;
      if (canReuseActiveBlock) {
        textBlock = this.activeRichTextBlock!;
        textBlock.content = semanticContent;
        if (resolvedSurface) textBlock.outputSurface = resolvedSurface;
      } else {
        textBlock = {
          type: 'text',
          content: state.currentTextContent,
          ...(resolvedSurface ? { outputSurface: resolvedSurface } : {}),
        };
        msg.contentBlocks = msg.contentBlocks || [];
        msg.contentBlocks.push(textBlock);
      }

      if (hasOrderedRemainder) {
        const remainder = completedSplit!.remainder;
        if (state.currentTextEl) {
          await renderer.renderContent(
            state.currentTextEl,
            semanticContent,
            { outputSurface: resolvedSurface! },
          );
          renderer.addTextCopyButton(state.currentTextEl, semanticContent);
        }

        const remainderSurface = resolveRichOutputSurface(remainder);
        const remainderBlock: Extract<ContentBlock, { type: 'text' }> = {
          type: 'text',
          content: remainder,
          ...(remainderSurface ? { outputSurface: remainderSurface } : {}),
        };
        msg.contentBlocks = msg.contentBlocks || [];
        msg.contentBlocks.push(remainderBlock);
        if (state.currentContentEl) {
          const remainderEl = state.currentContentEl.createDiv({ cls: 'claudian-text-block' });
          if (remainderSurface) {
            await renderer.renderContent(remainderEl, remainder, { outputSurface: remainderSurface });
          } else {
            await renderer.renderContent(remainderEl, remainder);
          }
          renderer.addTextCopyButton(remainderEl, remainder);
        }

        this.activeRichTextBlock = null;
        this.activeRichMessageId = null;
        state.currentTextEl = null;
        state.currentTextContent = '';
        this.currentTextOutputSurface = undefined;
        return;
      }

      const preserveRichOutput = options?.preserveRichOutput === true
        && resolvedSurface !== undefined
        && shouldContinueRichOutputAcrossTool(state.currentTextContent, resolvedSurface);
      if (preserveRichOutput) {
        this.activeRichTextBlock = textBlock;
        this.activeRichMessageId = msg.id;
        return;
      }

      this.activeRichTextBlock = null;
      this.activeRichMessageId = null;
      // Copy button added here (not during streaming) to match history-loaded messages
      if (state.currentTextEl) {
        renderer.addTextCopyButton(state.currentTextEl, state.currentTextContent);
      }
    }
    state.currentTextEl = null;
    state.currentTextContent = '';
    this.currentTextOutputSurface = undefined;
  }

  private scheduleCurrentTextRender(): Promise<void> {
    const { state } = this.deps;
    if (!this.pendingTextRenderPromise) {
      this.pendingTextRenderPromise = new Promise(resolve => {
        this.resolvePendingTextRender = resolve;
      });
    }

    if (this.pendingTextRenderFrame === null && !this.isTextRenderRunning) {
      this.pendingTextRenderFrame = scheduleAnimationFrame(() => {
        this.pendingTextRenderFrame = null;
        void this.renderPendingText();
      }, this.getStreamingRenderWindow(), this.getAdaptiveRenderDelay(state.currentTextContent, this.textRenderCostMs));
    }

    return this.pendingTextRenderPromise;
  }

  private async flushPendingTextRender(): Promise<void> {
    const pendingRender = this.pendingTextRenderPromise;
    if (!pendingRender) return;

    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
      void this.renderPendingText();
    }

    await pendingRender;
  }

  private async renderPendingText(): Promise<void> {
    if (this.isTextRenderRunning) return;
    this.isTextRenderRunning = true;

    const { state, renderer } = this.deps;
    const textEl = state.currentTextEl;
    const content = state.currentTextContent;

    const startedAt = Date.now();
    try {
      if (textEl) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(textEl, content, options);
        } else {
          await renderer.renderContent(textEl, content);
        }
        this.scrollToBottom();
        this.textRenderCostMs = StreamController.blendRenderCost(
          this.textRenderCostMs,
          Date.now() - startedAt,
        );
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isTextRenderRunning = false;
    }

    if (state.currentTextEl === textEl && state.currentTextContent !== content) {
      this.pendingTextRenderFrame = scheduleAnimationFrame(() => {
        this.pendingTextRenderFrame = null;
        void this.renderPendingText();
      }, this.getStreamingRenderWindow(), this.getAdaptiveRenderDelay(state.currentTextContent, this.textRenderCostMs));
      return;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  private cancelPendingTextRender(): void {
    if (this.pendingTextRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingTextRenderFrame);
      this.pendingTextRenderFrame = null;
    }

    const resolve = this.resolvePendingTextRender;
    this.pendingTextRenderPromise = null;
    this.resolvePendingTextRender = null;
    resolve?.();
  }

  private scheduleToolOutputRender(toolId: string, toolCall: ToolCallInfo): void {
    if (this.pendingToolOutputFrames.has(toolId)) return;

    const frame = scheduleAnimationFrame(() => {
      this.pendingToolOutputFrames.delete(toolId);
      updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
      this.scrollToBottom();
    }, this.getMessagesWindow());
    this.pendingToolOutputFrames.set(toolId, frame);
  }

  private cancelPendingToolOutputRender(toolId: string): void {
    const frame = this.pendingToolOutputFrames.get(toolId);
    if (!frame) return;

    cancelScheduledAnimationFrame(frame);
    this.pendingToolOutputFrames.delete(toolId);
  }

  private cancelPendingToolOutputRenders(): void {
    for (const frame of this.pendingToolOutputFrames.values()) {
      cancelScheduledAnimationFrame(frame);
    }
    this.pendingToolOutputFrames.clear();
  }

  // ============================================
  // Thinking Block Management
  // ============================================

  async appendThinking(content: string): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentContentEl) return;

    this.hideThinkingIndicator();
    if (!state.currentThinkingState) {
      state.currentThinkingState = createThinkingBlock(
        state.currentContentEl,
        (el, md) => renderer.renderContent(el, md)
      );
    }

    state.currentThinkingState.content += content;
    void this.scheduleCurrentThinkingRender();
  }

  async finalizeCurrentThinkingBlock(msg?: ChatMessage): Promise<void> {
    const { state, renderer } = this.deps;
    if (!state.currentThinkingState) return;
    await this.flushPendingThinkingRender();

    const thinkingState = state.currentThinkingState;
    if (this.getStreamingRenderOptions(thinkingState.content)) {
      await renderer.renderContent(thinkingState.contentEl, thinkingState.content);
    }

    const durationSeconds = finalizeThinkingBlock(thinkingState);

    if (msg && thinkingState.content) {
      msg.contentBlocks = msg.contentBlocks || [];
      msg.contentBlocks.push({
        type: 'thinking',
        content: thinkingState.content,
        durationSeconds,
      });
    }

    state.currentThinkingState = null;
  }

  private scheduleCurrentThinkingRender(): Promise<void> {
    const { state } = this.deps;
    if (!this.pendingThinkingRenderPromise) {
      this.pendingThinkingRenderPromise = new Promise(resolve => {
        this.resolvePendingThinkingRender = resolve;
      });
    }

    if (this.pendingThinkingRenderFrame === null && !this.isThinkingRenderRunning) {
      this.pendingThinkingRenderFrame = scheduleAnimationFrame(() => {
        this.pendingThinkingRenderFrame = null;
        void this.renderPendingThinking();
      }, this.getThinkingRenderWindow(), this.getAdaptiveRenderDelay(state.currentThinkingState?.content ?? '', this.thinkingRenderCostMs));
    }

    return this.pendingThinkingRenderPromise;
  }

  private async flushPendingThinkingRender(): Promise<void> {
    const pendingRender = this.pendingThinkingRenderPromise;
    if (!pendingRender) return;

    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
      void this.renderPendingThinking();
    }

    await pendingRender;
  }

  private async renderPendingThinking(): Promise<void> {
    if (this.isThinkingRenderRunning) return;
    this.isThinkingRenderRunning = true;

    const { state, renderer } = this.deps;
    const thinkingState = state.currentThinkingState;
    const content = thinkingState?.content ?? '';

    const startedAt = Date.now();
    try {
      if (thinkingState) {
        const options = this.getStreamingRenderOptions(content);
        if (options) {
          await renderer.renderContent(thinkingState.contentEl, content, options);
        } else {
          await renderer.renderContent(thinkingState.contentEl, content);
        }
        this.scrollToBottom();
        this.thinkingRenderCostMs = StreamController.blendRenderCost(
          this.thinkingRenderCostMs,
          Date.now() - startedAt,
        );
      }
    } catch {
      // MessageRenderer owns user-visible render fallback; keep stream state moving.
    } finally {
      this.isThinkingRenderRunning = false;
    }

    if (state.currentThinkingState === thinkingState && thinkingState && thinkingState.content !== content) {
      this.pendingThinkingRenderFrame = scheduleAnimationFrame(() => {
        this.pendingThinkingRenderFrame = null;
        void this.renderPendingThinking();
      }, this.getThinkingRenderWindow(), this.getAdaptiveRenderDelay(thinkingState.content, this.thinkingRenderCostMs));
      return;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  private cancelPendingThinkingRender(): void {
    if (this.pendingThinkingRenderFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingThinkingRenderFrame);
      this.pendingThinkingRenderFrame = null;
    }

    const resolve = this.resolvePendingThinkingRender;
    this.pendingThinkingRenderPromise = null;
    this.resolvePendingThinkingRender = null;
    resolve?.();
  }

  // ============================================
  // Subagent Tool Handling (via SubagentManager)
  // ============================================

  /** Delegates Agent tool_use to SubagentManager and updates message based on result. */
  private handleTaskToolUseViaManager(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    msg: ChatMessage
  ): void {
    const { state, subagentManager } = this.deps;
    this.ensureTaskToolCall(msg, chunk.id, chunk.input);

    const result = subagentManager.handleTaskToolUse(chunk.id, chunk.input, state.currentContentEl);

    switch (result.action) {
      case 'created_sync':
        this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
        this.showThinkingIndicator();
        break;
      case 'created_async':
        this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
        this.showThinkingIndicator();
        break;
      case 'buffered':
        this.showThinkingIndicator();
        break;
      case 'label_updated':
        break;
    }
  }

  /** Renders a pending Agent tool call via SubagentManager and updates message. */
  private renderPendingTaskViaManager(toolId: string, msg: ChatMessage): void {
    const result = this.deps.subagentManager.renderPendingTask(toolId, this.deps.state.currentContentEl);
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, toolId);
    } else {
      this.recordSubagentInMessage(msg, result.info, toolId, 'async');
    }
  }

  /** Resolves a pending Agent tool call when its own tool_result arrives. */
  private renderPendingTaskFromTaskResultViaManager(
    chunk: { id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const result = this.deps.subagentManager.renderPendingTaskFromTaskResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      this.deps.state.currentContentEl,
      chunk.toolUseResult
    );
    if (!result) return;

    if (result.mode === 'sync') {
      this.recordSubagentInMessage(msg, result.subagentState.info, chunk.id);
    } else {
      this.recordSubagentInMessage(msg, result.info, chunk.id, 'async');
    }
  }

  private recordSubagentInMessage(
    msg: ChatMessage,
    info: SubagentInfo,
    toolId: string,
    mode?: 'async'
  ): void {
    const taskToolCall = this.ensureTaskToolCall(msg, toolId);
    this.applySubagentToTaskToolCall(taskToolCall, info);

    msg.contentBlocks = msg.contentBlocks || [];
    const existingBlock = msg.contentBlocks.find(
      block => block.type === 'subagent' && block.subagentId === toolId
    );
    if (existingBlock && mode && existingBlock.type === 'subagent') {
      existingBlock.mode = mode;
    } else if (!existingBlock) {
      msg.contentBlocks.push(mode
        ? { type: 'subagent', subagentId: toolId, mode }
        : { type: 'subagent', subagentId: toolId }
      );
    }
  }

  private async handleSubagentChunk(
    chunk: Extract<StreamChunk, { type: 'subagent_tool_use' | 'subagent_tool_result' }>,
    msg: ChatMessage,
  ): Promise<void> {
    const parentToolUseId = chunk.subagentId;
    const { subagentManager } = this.deps;

    // If parent Agent call is still pending, child chunk confirms it's sync - render now
    if (subagentManager.hasPendingTask(parentToolUseId)) {
      this.renderPendingTaskViaManager(parentToolUseId, msg);
    }

    const subagentState = subagentManager.getSyncSubagent(parentToolUseId);

    if (!subagentState) {
      return;
    }

    switch (chunk.type) {
      case 'subagent_tool_use': {
        const toolCall: ToolCallInfo = {
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
          status: 'running',
          isExpanded: false,
        };
        subagentManager.addSyncToolCall(parentToolUseId, toolCall);
        this.showThinkingIndicator();
        break;
      }

      case 'subagent_tool_result': {
        const toolCall = subagentState.info.toolCalls.find((tc: ToolCallInfo) => tc.id === chunk.id);
        if (toolCall) {
          const normalizedContent = this.normalizeToolResultContent(chunk.content);
          const isBlocked = isBlockedToolResult(normalizedContent, chunk.isError);
          toolCall.status = isBlocked ? 'blocked' : (chunk.isError ? 'error' : 'completed');
          toolCall.result = normalizedContent;
          subagentManager.updateSyncToolResult(parentToolUseId, chunk.id, toolCall);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Finalizes a sync subagent when its Agent tool_result is received. */
  private finalizeSubagent(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown },
    msg: ChatMessage
  ): void {
    const isError = chunk.isError || false;
    const normalizedContent = this.normalizeToolResultContent(chunk.content);
    const finalized = this.deps.subagentManager.finalizeSyncSubagent(
      chunk.id, chunk.content, isError, chunk.toolUseResult
    );

    const extractedResult = finalized?.result ?? normalizedContent;

    const taskToolCall = this.ensureTaskToolCall(msg, chunk.id);
    taskToolCall.status = isError ? 'error' : 'completed';
    taskToolCall.result = extractedResult;
    if (taskToolCall.subagent) {
      taskToolCall.subagent.status = isError ? 'error' : 'completed';
      taskToolCall.subagent.result = extractedResult;
    }

    if (finalized) {
      this.applySubagentToTaskToolCall(taskToolCall, finalized);
    }

    this.showThinkingIndicator();
  }

  // ============================================
  // Async Subagent Handling
  // ============================================

  /** Handles TaskOutput tool_use (invisible, links to async subagent). */
  private handleAgentOutputToolUse(
    chunk: { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> },
    _msg: ChatMessage
  ): void {
    const toolCall: ToolCallInfo = {
      id: chunk.id,
      name: chunk.name,
      input: chunk.input,
      status: 'running',
      isExpanded: false,
    };

    this.deps.subagentManager.handleAgentOutputToolUse(toolCall);

    // Show flavor text while waiting for TaskOutput result
    this.showThinkingIndicator();
  }

  private handleAsyncTaskToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): boolean {
    const { subagentManager } = this.deps;
    if (!subagentManager.isPendingAsyncTask(chunk.id)) {
      return false;
    }

    subagentManager.handleTaskToolResult(chunk.id, chunk.content, chunk.isError, chunk.toolUseResult);
    return true;
  }

  /** Handles TaskOutput result to finalize async subagent. */
  private async handleAgentOutputToolResult(
    chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: unknown }
  ): Promise<boolean> {
    const { subagentManager } = this.deps;
    const isLinked = subagentManager.isLinkedAgentOutputTool(chunk.id);

    const handled = subagentManager.handleAgentOutputToolResult(
      chunk.id,
      chunk.content,
      chunk.isError || false,
      chunk.toolUseResult
    );

    await this.hydrateAsyncSubagentToolCalls(handled);

    return isLinked || handled !== undefined;
  }

  private async handleAsyncSubagentResult(
    chunk: Extract<StreamChunk, { type: 'async_subagent_result' }>
  ): Promise<void> {
    const handled = this.deps.subagentManager.handleAsyncSubagentResult(
      chunk.agentId,
      chunk.status,
      chunk.result
    );

    await this.hydrateAsyncSubagentToolCalls(handled);
    if (handled) {
      this.showThinkingIndicator();
    }
  }

  private async hydrateAsyncSubagentToolCalls(subagent: SubagentInfo | undefined): Promise<void> {
    if (!subagent) return;
    if (subagent.mode !== 'async') return;
    if (!subagent.agentId) return;

    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const runtime = this.deps.getAgentService?.();
    if (!runtime) return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      true
    );

    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, 0);
    }
  }

  private async tryHydrateAsyncSubagent(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    hydrateToolCalls: boolean
  ): Promise<{ hasHydrated: boolean; finalResultHydrated: boolean }> {
    let hasHydrated = false;
    let finalResultHydrated = false;

    if (hydrateToolCalls && !subagent.toolCalls?.length) {
      const recoveredToolCalls = await runtime.loadSubagentToolCalls?.(
        subagent.agentId || ''
      ) ?? [];
      if (recoveredToolCalls.length > 0) {
        subagent.toolCalls = recoveredToolCalls.map((toolCall) => ({
          ...toolCall,
          input: { ...toolCall.input },
        }));
        hasHydrated = true;
      }
    }

    const recoveredFinalResult = await runtime.loadSubagentFinalResult?.(
      subagent.agentId || ''
    ) ?? null;
    if (recoveredFinalResult && recoveredFinalResult.trim().length > 0) {
      finalResultHydrated = true;
      if (recoveredFinalResult !== subagent.result) {
        subagent.result = recoveredFinalResult;
        hasHydrated = true;
      }
    }

    return { hasHydrated, finalResultHydrated };
  }

  private scheduleAsyncSubagentResultRetry(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number
  ): void {
    if (!subagent.agentId) return;
    if (attempt >= StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS.length) return;

    const delay = StreamController.ASYNC_SUBAGENT_RESULT_RETRY_DELAYS_MS[attempt];
    window.setTimeout(() => {
      void this.retryAsyncSubagentResult(subagent, runtime, attempt);
    }, delay);
  }

  private async retryAsyncSubagentResult(
    subagent: SubagentInfo,
    runtime: ChatRuntime,
    attempt: number
  ): Promise<void> {
    if (!subagent.agentId) return;
    const asyncStatus = subagent.asyncStatus ?? subagent.status;
    if (asyncStatus !== 'completed' && asyncStatus !== 'error') return;

    const { hasHydrated, finalResultHydrated } = await this.tryHydrateAsyncSubagent(
      subagent,
      runtime,
      false
    );
    if (hasHydrated) {
      this.deps.subagentManager.refreshAsyncSubagent(subagent);
    }

    if (!finalResultHydrated) {
      this.scheduleAsyncSubagentResultRetry(subagent, runtime, attempt + 1);
    }
  }

  /** Callback from SubagentManager when async state changes. Updates messages only (DOM handled by manager). */
  onAsyncSubagentStateChange(subagent: SubagentInfo): void {
    this.updateSubagentInMessages(subagent);
    this.scrollToBottom();
  }

  private updateSubagentInMessages(subagent: SubagentInfo): void {
    const { state } = this.deps;
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg.role !== 'assistant') continue;
      if (this.linkTaskToolCallToSubagent(msg, subagent)) {
        return;
      }
    }
  }

  private ensureTaskToolCall(
    msg: ChatMessage,
    toolId: string,
    input?: Record<string, unknown>
  ): ToolCallInfo {
    msg.toolCalls = msg.toolCalls || [];
    const existing = msg.toolCalls.find(
      tc => tc.id === toolId && isSubagentToolName(tc.name)
    );
    if (existing) {
      if (input && Object.keys(input).length > 0) {
        existing.input = { ...existing.input, ...input };
      }
      return existing;
    }

    const taskToolCall: ToolCallInfo = {
      id: toolId,
      name: TOOL_TASK,
      input: input ? { ...input } : {},
      status: 'running',
      isExpanded: false,
    };
    msg.toolCalls.push(taskToolCall);
    return taskToolCall;
  }

  private applySubagentToTaskToolCall(taskToolCall: ToolCallInfo, subagent: SubagentInfo): void {
    taskToolCall.subagent = subagent;
    if (subagent.status === 'completed') taskToolCall.status = 'completed';
    else if (subagent.status === 'error') taskToolCall.status = 'error';
    else taskToolCall.status = 'running';
    if (subagent.result !== undefined) {
      taskToolCall.result = subagent.result;
    }
  }

  private linkTaskToolCallToSubagent(msg: ChatMessage, subagent: SubagentInfo): boolean {
    const taskToolCall = msg.toolCalls?.find(
      tc => tc.id === subagent.id && isSubagentToolName(tc.name)
    );
    if (!taskToolCall) return false;
    this.applySubagentToTaskToolCall(taskToolCall, subagent);
    return true;
  }

  // ============================================
  // Thinking Indicator
  // ============================================

  /** Debounce delay before showing thinking indicator (ms). */
  private static readonly THINKING_INDICATOR_DELAY = 400;

  /**
   * Schedules showing the thinking indicator after a delay.
   * If content arrives before the delay, the indicator won't show.
   * This prevents the indicator from appearing during active streaming.
   * Note: Flavor text is hidden when model thinking block is active (thinking takes priority).
   */
  showThinkingIndicator(overrideText?: string, overrideCls?: string): void {
    const { state } = this.deps;

    // Early return if no content element
    if (!state.currentContentEl) return;

    // Clear any existing timeout
    if (state.thinkingIndicatorTimeout) {
      const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(timerWindow);
    }

    // Don't show flavor text while model thinking block is active
    if (state.currentThinkingState) {
      return;
    }

    // If indicator already exists, just re-append it to the bottom
    if (state.thinkingEl) {
      state.currentContentEl.appendChild(state.thinkingEl);
      this.deps.updateQueueIndicator();
      return;
    }

    // Schedule showing the indicator after a delay
    const timerWindow = state.currentContentEl.ownerDocument.defaultView ?? window;
    state.setThinkingIndicatorTimeout(timerWindow.setTimeout(() => {
      state.setThinkingIndicatorTimeout(null, null);
      // Double-check we still have a content element, no indicator exists, and no thinking block
      if (!state.currentContentEl || state.thinkingEl || state.currentThinkingState) return;

      const cls = overrideCls
        ? `claudian-thinking ${overrideCls}`
        : 'claudian-thinking';
      state.thinkingEl = state.currentContentEl.createDiv({ cls });
      const text = overrideText || FLAVOR_TEXTS[Math.floor(Math.random() * FLAVOR_TEXTS.length)];
      this.deps.updateLiveActivity?.({
        primary: 'Warte auf nächsten Provider-Event',
        meta: text,
        phrase: text.replace(/\.\.\.$/, ''),
      });
      state.thinkingEl.createSpan({ text });

      // Create timer span with initial value
      const timerSpan = state.thinkingEl.createSpan({ cls: 'claudian-thinking-hint' });
      const updateTimer = () => {
        if (!state.responseStartTime) return;
        // Check if element is still connected to DOM (prevents orphaned interval updates)
        if (!timerSpan.isConnected) {
          if (state.flavorTimerInterval) {
            state.clearFlavorTimerInterval();
          }
          return;
        }
        const elapsedSeconds = Math.floor((performance.now() - state.responseStartTime) / 1000);
        timerSpan.setText(` (esc to interrupt · ${formatDurationMmSs(elapsedSeconds)})`);
      };
      updateTimer(); // Initial update

      // Start interval to update timer every second
      if (state.flavorTimerInterval) {
        state.clearFlavorTimerInterval();
      }
      const thinkingWindow = state.currentContentEl.ownerDocument.defaultView ?? timerWindow;
      state.setFlavorTimerInterval(thinkingWindow.setInterval(updateTimer, 1000), thinkingWindow);

    }, StreamController.THINKING_INDICATOR_DELAY), timerWindow);
  }

  /** Hides the thinking indicator and cancels any pending show timeout. */
  hideThinkingIndicator(): void {
    const { state } = this.deps;

    // Cancel any pending show timeout
    if (state.thinkingIndicatorTimeout) {
      const activeWindow = this.deps.getMessagesEl().ownerDocument.defaultView ?? window;
      state.clearThinkingIndicatorTimeout(activeWindow);
    }

    // Clear timer interval (but preserve responseStartTime for duration capture)
    state.clearFlavorTimerInterval();

    if (state.thinkingEl) {
      state.thinkingEl.remove();
      state.thinkingEl = null;
    }
  }

  // ============================================
  // Compact Boundary
  // ============================================

  private renderCompactBoundary(): void {
    const { state } = this.deps;
    if (!state.currentContentEl) return;
    this.hideThinkingIndicator();
    const el = state.currentContentEl.createDiv({ cls: 'claudian-compact-boundary' });
    el.createSpan({ cls: 'claudian-compact-boundary-label', text: 'Unterhaltung verdichtet' });
  }

  // ============================================
  // Utilities
  // ============================================

  /**
   * Nudges Obsidian's vault after a Write/Edit/NotebookEdit so the file tree
   * refreshes. Direct `fs` writes bypass the Vault API, and macOS + iCloud
   * FSWatcher often misses the event.
   */
  private notifyVaultFileChange(input: Record<string, unknown>): void {
    const rawPathValue = input.file_path ?? input.notebook_path;
    const rawPath = typeof rawPathValue === 'string' ? rawPathValue : undefined;
    const vaultPath = getVaultPath(this.deps.plugin.app);
    const relativePath = normalizePathForVault(rawPath, vaultPath);
    if (!relativePath || relativePath.startsWith('/')) return;

    window.setTimeout(() => {
      const { vault } = this.deps.plugin.app;
      const file = vault.getAbstractFileByPath(relativePath);
      if (file instanceof TFile) {
        // Existing file — tell listeners the content changed
        vault.trigger('modify', file);
      } else {
        // New file — scan parent directory so Obsidian discovers it
        const parentDir = relativePath.includes('/')
          ? relativePath.substring(0, relativePath.lastIndexOf('/'))
          : '';
        vault.adapter.list(parentDir).catch(() => { /* ignore */ });
      }
    }, 200);
  }

  /** Refreshes vault for each file path in an apply_patch changes array or patch text. */
  private notifyApplyPatchFileChanges(input: Record<string, unknown>): void {
    const notified = new Set<string>();

    // Legacy changes array
    const changes = input.changes;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (change && typeof change === 'object' && !Array.isArray(change)) {
          const changeRecord = change as Record<string, unknown>;
          if (typeof changeRecord.path === 'string') {
            notified.add(changeRecord.path);
            this.notifyVaultFileChange({ file_path: changeRecord.path });
          }
        }
      }
    }

    // Parse file paths from patch text markers (current custom_tool_call format)
    const patchText = typeof input.patch === 'string' ? input.patch : '';
    if (patchText) {
      for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
        const filePath = match[1]?.trim();
        if (filePath && !notified.has(filePath)) {
          this.notifyVaultFileChange({ file_path: filePath });
        }
      }
    }
  }

  /** Scrolls messages to bottom if auto-scroll is enabled. */
  private scrollToBottom(): void {
    if (this.pendingScrollFrame !== null) return;

    this.pendingScrollFrame = scheduleAnimationFrame(() => {
      this.pendingScrollFrame = null;
      this.applyScrollToBottom();
    }, this.getMessagesWindow());
  }

  private applyScrollToBottom(): void {
    const { state, plugin } = this.deps;
    if (!(plugin.settings.enableAutoScroll ?? true)) return;
    if (!state.autoScrollEnabled) return;

    const messagesEl = this.deps.getMessagesEl();
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  private cancelPendingScroll(): void {
    if (this.pendingScrollFrame === null) return;

    cancelScheduledAnimationFrame(this.pendingScrollFrame);
    this.pendingScrollFrame = null;
  }

  private getMessagesWindow(): Window | null {
    return this.deps.getMessagesEl().ownerDocument.defaultView ?? null;
  }

  private getStreamingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentTextEl?.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  private getThinkingRenderWindow(): Window | null {
    const { state } = this.deps;
    return state.currentThinkingState?.contentEl.ownerDocument?.defaultView
      ?? state.currentContentEl?.ownerDocument?.defaultView
      ?? this.getMessagesWindow();
  }

  /**
   * Weight of a fresh sample in the render-cost average. Low enough that one
   * slow frame (a GC pause, a cold highlighter) does not stall the stream, high
   * enough to follow the real upward trend as the answer grows.
   */
  private static readonly RENDER_COST_SMOOTHING = 0.3;

  private static blendRenderCost(previous: number | null, sampleMs: number): number {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return previous ?? 0;
    if (previous === null) return sampleMs;
    return previous + (sampleMs - previous) * StreamController.RENDER_COST_SMOOTHING;
  }

  private getAdaptiveRenderDelay(content: string, lastRenderMs: number | null = null): number {
    const document = this.deps.getMessagesEl().ownerDocument;
    const floorMs = getAdaptiveStreamRenderDelay(
      content.length,
      document.visibilityState !== 'hidden',
    );
    return getRenderBudgetDelay(floorMs, lastRenderMs);
  }

  resetStreamingState(): void {
    const { state } = this.deps;
    // Re-learn the render cost per turn. Carrying a long answer's 400ms budget
    // into the next turn would make a three-word reply render a third of a
    // second late; one over-eager first frame is the cheaper trade.
    this.textRenderCostMs = null;
    this.thinkingRenderCostMs = null;
    this.inlineThinkScrubber = createInlineThinkScrubber();
    this.cancelPendingTextRender();
    this.cancelPendingThinkingRender();
    this.cancelPendingToolOutputRenders();
    this.cancelPendingScroll();
    this.hideThinkingIndicator();
    state.currentContentEl = null;
    state.currentTextEl = null;
    state.currentTextContent = '';
    this.currentTextOutputSurface = undefined;
    this.activeRichTextBlock = null;
    this.activeRichMessageId = null;
    state.currentThinkingState = null;
    this.deps.subagentManager.resetStreamingState();
    state.pendingTools.clear();
    // Reset response timer (duration already captured at this point)
    state.responseStartTime = null;
  }
}
