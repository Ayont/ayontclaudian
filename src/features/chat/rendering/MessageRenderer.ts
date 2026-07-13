import type { App, Component } from 'obsidian';
import { MarkdownRenderer, Menu, Notice, setIcon } from 'obsidian';

import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { DEFAULT_CHAT_PROVIDER_ID, type ProviderCapabilities, type ProviderId } from '../../../core/providers/types';
import type { ChatRewindMode } from '../../../core/runtime/types';
import {
  isSubagentToolName,
  isWriteEditTool,
  TOOL_AGENT_OUTPUT,
  TOOL_APPLY_PATCH,
  TOOL_WRITE_STDIN,
} from '../../../core/tools/toolNames';
import { extractToolResultContent } from '../../../core/tools/toolResultContent';
import type { ChatMessage, ImageAttachment, MessageAttachment, SubagentInfo, ToolCallInfo } from '../../../core/types';
import { t } from '../../../i18n/i18n';
import type ClaudianPlugin from '../../../main';
import { extractInjectedContextPrompt, extractUserDisplayContent } from '../../../utils/context';
import { formatDurationMmSs } from '../../../utils/date';
import { processFileLinks, registerFileLinkHandler } from '../../../utils/fileLink';
import { replaceImageEmbedsWithHtml } from '../../../utils/imageEmbed';
import { escapeMathDelimitersForStreaming } from '../../../utils/markdownMath';
import { findRewindContext } from '../rewind';
import { exportAssistantResponse } from '../services/ResponseExportService';
import { attachmentTypeMeta } from '../ui/file-drop/attachmentMeta';
import { renderAutoMemoryChips } from './AutoMemoryChip';
import { renderEmailTemplates } from './EmailTemplateRenderer';
import { detectStatusCard } from './errorClassification';
import { renderLiveDocuments } from './LiveDocumentRenderer';
import { renderNetworkMaps } from './NetworkMapRenderer';
import { renderSkillCards } from './SkillCardRenderer';
import { renderStatusCard } from './StatusCardRenderer';
import { resolveSubagentLifecycleAdapter } from './subagentLifecycleResolution';
import {
  renderStoredAsyncSubagent,
  renderStoredSubagent,
} from './SubagentRenderer';
import { renderStoredThinkingBlock } from './ThinkingBlockRenderer';
import { renderStoredToolCall } from './ToolCallRenderer';
import { renderStoredWriteEdit } from './WriteEditRenderer';

export interface RenderContentOptions {
  deferMath?: boolean;
}

export type RenderContentFn = (
  el: HTMLElement,
  markdown: string,
  options?: RenderContentOptions
) => Promise<void>;

function runRendererAction(action: () => Promise<void>): void {
  void action().catch(() => {
    // UI actions already surface expected failures locally.
  });
}

/** How long the code-block Copy button stays in its "Copied" state (ms). */
const CODE_COPY_FEEDBACK_MS = 1500;
export const CODE_COLLAPSE_LINE_THRESHOLD = 18;
export const MAX_CODE_GUTTER_LINES = 300;
export const STORED_TOOL_GROUP_THRESHOLD = 4;
const LOW_SIGNAL_STORED_TOOLS = new Set(['exec', 'wait', 'wait_agent']);

export function shouldGroupStoredToolCalls(toolCalls: readonly ToolCallInfo[]): boolean {
  return toolCalls.length >= STORED_TOOL_GROUP_THRESHOLD
    && toolCalls.every((toolCall) => LOW_SIGNAL_STORED_TOOLS.has(toolCall.name.toLowerCase()));
}

export function getCodeLineCount(code: string): number {
  if (!code) return 1;
  const normalized = code.replace(/\r\n/g, '\n');
  const withoutTrailingNewline = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;
  return Math.max(1, withoutTrailingNewline.split('\n').length);
}

export interface AssistantMessageMetrics {
  words: number;
  tools: number;
}

export function getAssistantMessageMetrics(msg: ChatMessage): AssistantMessageMetrics {
  const plainText = msg.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`~>[\]()]/g, ' ')
    .trim();
  return {
    words: plainText ? plainText.split(/\s+/).length : 0,
    tools: msg.toolCalls?.length ?? 0,
  };
}

/**
 * Turns a plain rendered <pre> into a compact code workspace with language and
 * line telemetry, fixed line numbers, wrap/collapse controls, and copy feedback.
 */
function addCodeBlockHeader(
  wrapperEl: HTMLElement,
  preEl: HTMLElement,
  language: string | null
): void {
  const codeEl = preEl.querySelector('code');
  const rawCode = codeEl?.textContent ?? preEl.textContent ?? '';
  const lineCount = getCodeLineCount(rawCode);
  const headerEl = createEl('div', { cls: 'claudian-code-header' });
  const identityEl = headerEl.createDiv({ cls: 'claudian-code-identity' });
  const langEl = identityEl.createSpan({ cls: 'claudian-code-lang' });
  langEl.setText(language ?? 'text');
  identityEl.createSpan({
    cls: 'claudian-code-lines',
    text: `${lineCount.toLocaleString()} ${lineCount === 1 ? 'Zeile' : 'Zeilen'}`,
  });

  const actionsEl = headerEl.createDiv({ cls: 'claudian-code-actions' });
  const wrapBtn = actionsEl.createEl('button', { cls: 'claudian-code-action' });
  wrapBtn.setAttribute('type', 'button');
  wrapBtn.setAttribute('aria-label', 'Lange Codezeilen umbrechen');
  wrapBtn.setAttribute('aria-pressed', 'false');
  setIcon(wrapBtn.createSpan(), 'wrap-text');

  let collapseBtn: HTMLButtonElement | null = null;
  if (lineCount > CODE_COLLAPSE_LINE_THRESHOLD) {
    wrapperEl.addClass('is-collapsible');
    wrapperEl.addClass('is-collapsed');
    collapseBtn = actionsEl.createEl('button', { cls: 'claudian-code-action' });
    collapseBtn.setAttribute('type', 'button');
    collapseBtn.setAttribute('aria-label', 'Vollständigen Code anzeigen');
    collapseBtn.setAttribute('aria-expanded', 'false');
    setIcon(collapseBtn.createSpan(), 'chevrons-up-down');
  }

  const copyBtn = actionsEl.createEl('button', { cls: 'claudian-code-copy' });
  copyBtn.setAttribute('type', 'button');
  copyBtn.setAttribute('aria-label', 'Code kopieren');

  const iconEl = copyBtn.createSpan({ cls: 'claudian-code-copy-icon' });
  setIcon(iconEl, 'copy');
  const textEl = copyBtn.createSpan({ cls: 'claudian-code-copy-text' });
  textEl.setText('Kopieren');

  const bodyEl = createEl('div', { cls: 'claudian-code-body' });
  if (language && lineCount > 1 && lineCount <= MAX_CODE_GUTTER_LINES) {
    bodyEl.addClass('has-line-numbers');
    const gutterEl = bodyEl.createDiv({
      cls: 'claudian-code-gutter',
      attr: { 'aria-hidden': 'true' },
    });
    for (let line = 1; line <= lineCount; line++) {
      gutterEl.createSpan({ text: String(line) });
    }
    preEl.addEventListener('scroll', () => {
      gutterEl.scrollTop = preEl.scrollTop;
    }, { passive: true });
  }
  wrapperEl.insertBefore(headerEl, preEl);
  wrapperEl.insertBefore(bodyEl, preEl);
  bodyEl.appendChild(preEl);

  wrapBtn.addEventListener('click', () => {
    const wrapped = !wrapperEl.hasClass('is-wrapped');
    wrapperEl.toggleClass('is-wrapped', wrapped);
    wrapBtn.setAttribute('aria-pressed', wrapped ? 'true' : 'false');
    wrapBtn.setAttribute('aria-label', wrapped ? 'Codezeilen nicht umbrechen' : 'Lange Codezeilen umbrechen');
  });

  collapseBtn?.addEventListener('click', () => {
    const collapsed = wrapperEl.hasClass('is-collapsed');
    wrapperEl.toggleClass('is-collapsed', !collapsed);
    collapseBtn?.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
    collapseBtn?.setAttribute('aria-label', collapsed ? 'Code einklappen' : 'Vollständigen Code anzeigen');
  });

  let feedbackTimeout: number | null = null;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    runRendererAction(async () => {
      try {
        await navigator.clipboard.writeText(rawCode);
      } catch {
        // Clipboard API may fail in non-secure contexts.
        return;
      }

      if (feedbackTimeout) window.clearTimeout(feedbackTimeout);

      setIcon(iconEl, 'check');
      textEl.setText('Kopiert');
      copyBtn.classList.add('copied');

      feedbackTimeout = window.setTimeout(() => {
        setIcon(iconEl, 'copy');
        textEl.setText('Kopieren');
        copyBtn.classList.remove('copied');
        feedbackTimeout = null;
      }, CODE_COPY_FEEDBACK_MS);
    });
  });

}

function containsPotentialVaultLink(markdown: string): boolean {
  if (markdown.includes('[[')) {
    return true;
  }
  // Normal Markdown links that are not obviously external may point at vault
  // files (Antigravity often emits `[note](/02-Projekte/...)`).
  return /\[[^\]]+\]\((?!\s*(?:https?:|mailto:|tel:|obsidian:|app:|command:|javascript:|data:))[^)]+\)/i
    .test(markdown);
}

export class MessageRenderer {
  private app: App;
  private plugin: ClaudianPlugin;
  private component: Component;
  private messagesEl: HTMLElement;
  private rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>;
  private getCapabilities: () => ProviderCapabilities;
  private forkCallback?: (messageId: string) => Promise<void>;
  private switchModelCallback?: () => void;
  private liveMessageEls = new Map<string, HTMLElement>();
  /**
   * Provider used as a fallback for messages persisted before `agentProvider`
   * existed. Set per conversation (typically `conversation.providerId`) so
   * legacy history still gets a coherent color instead of the default brand.
   */
  private fallbackProviderId: ProviderId = DEFAULT_CHAT_PROVIDER_ID;
  /**
   * Tracks the provider of the most recently rendered message so we can insert
   * a switch-divider when a new message comes in from a different provider.
   * Reset to null at the start of every batch render so the first message
   * never gets a leading divider.
   */
  private lastRenderedProviderId: ProviderId | null = null;

  constructor(
    plugin: ClaudianPlugin,
    component: Component,
    messagesEl: HTMLElement,
    rewindCallback?: (messageId: string, mode?: ChatRewindMode) => Promise<void>,
    forkCallback?: (messageId: string) => Promise<void>,
    getCapabilities?: () => ProviderCapabilities,
    switchModelCallback?: () => void,
  ) {
    this.app = plugin.app;
    this.plugin = plugin;
    this.component = component;
    this.messagesEl = messagesEl;
    this.rewindCallback = rewindCallback;
    this.forkCallback = forkCallback;
    this.switchModelCallback = switchModelCallback;
    this.getCapabilities = getCapabilities ?? (() => ({
      providerId: DEFAULT_CHAT_PROVIDER_ID,
      supportsPersistentRuntime: false,
      supportsNativeHistory: false,
      supportsPlanMode: false,
      supportsRewind: false,
      supportsFork: false,
      supportsProviderCommands: false,
      supportsImageAttachments: false,
      supportsInstructionMode: false,
      supportsMcpTools: false,
      supportsMultiAgent: false,
      supportsTurnSteer: false,
      reasoningControl: 'none' as const,
    }));

    // Register delegated click handler for file links
    registerFileLinkHandler(this.app, this.messagesEl, this.component);
  }

  /** Sets the messages container element. */
  setMessagesEl(el: HTMLElement): void {
    this.messagesEl = el;
  }

  private getSubagentLifecycleAdapter(toolName?: string) {
    return resolveSubagentLifecycleAdapter(this.getCapabilities().providerId, toolName);
  }

  private shouldExpandFileEditsByDefault(): boolean {
    return this.plugin.settings?.expandFileEditsByDefault === true;
  }

  private getUserMessagePresentation(msg: ChatMessage): {
    text: string;
    vaultContext?: string;
    memoryContext?: string;
  } {
    const injectedContext = extractInjectedContextPrompt(msg.content);
    const displayContent = msg.displayContent
      ? extractUserDisplayContent(msg.displayContent) ?? msg.displayContent
      : undefined;
    return {
      text: displayContent ?? injectedContext?.userContent ?? extractUserDisplayContent(msg.content) ?? msg.content,
      ...(injectedContext?.vaultContext ? { vaultContext: injectedContext.vaultContext } : {}),
      ...(injectedContext?.memoryContext ? { memoryContext: injectedContext.memoryContext } : {}),
    };
  }

  private renderInjectedContextCard(
    parentEl: HTMLElement,
    vaultContext?: string,
    memoryContext?: string,
  ): void {
    const sourceCount = vaultContext
      ? (vaultContext.match(/^\s*(?:[-*]\s+)?From \[\[/gm) ?? []).length
      : 0;
    const memoryCount = memoryContext
      ? (memoryContext.match(/^\s*[-*]\s+\*\*/gm) ?? []).length
      : 0;
    const summaryParts = [
      ...(vaultContext ? [`${sourceCount || 'Vault'} Vault-Quelle${sourceCount === 1 ? '' : 'n'}`] : []),
      ...(memoryContext ? [`${memoryCount || 'KI'} Erinnerung${memoryCount === 1 ? '' : 'en'}`] : []),
    ];
    const detailsEl = parentEl.createEl('details', { cls: 'claudian-vault-context-card' });
    detailsEl.setAttribute('aria-label', 'Verwendeten KI-Kontext anzeigen');
    const summaryEl = detailsEl.createEl('summary', { cls: 'claudian-vault-context-summary' });
    const iconEl = summaryEl.createSpan({ cls: 'claudian-vault-context-icon' });
    setIcon(iconEl, memoryContext ? 'brain' : 'library-big');
    summaryEl.createSpan({
      cls: 'claudian-vault-context-title',
      text: summaryParts.join(' · ') || 'Verwendeter KI-Kontext',
    });
    summaryEl.createSpan({ cls: 'claudian-vault-context-hint', text: 'anzeigen' });
    const bodyEl = detailsEl.createDiv({ cls: 'claudian-vault-context-body' });
    if (vaultContext) {
      bodyEl.createDiv({ cls: 'claudian-vault-context-section-title', text: 'Vault-Wissen' });
      const vaultBodyEl = bodyEl.createDiv({ cls: 'claudian-vault-context-section' });
      void this.renderContent(vaultBodyEl, vaultContext);
    }
    if (memoryContext) {
      bodyEl.createDiv({ cls: 'claudian-vault-context-section-title', text: 'Erinnerungen' });
      const memoryBodyEl = bodyEl.createDiv({ cls: 'claudian-vault-context-section' });
      void this.renderContent(memoryBodyEl, memoryContext);
    }
  }

  // ============================================
  // Per-Message Provider Branding
  // ============================================

  /**
   * Sets the fallback provider used for legacy messages without `agentProvider`.
   * Should be called whenever a conversation is loaded or switched, before
   * `renderMessages()` runs.
   */
  setFallbackProvider(providerId: ProviderId): void {
    this.fallbackProviderId = providerId;
  }

  /** Returns the provider that owns a given message (explicit stamp or fallback). */
  private resolveMessageProvider(msg: ChatMessage): ProviderId {
    return msg.agentProvider ?? this.fallbackProviderId;
  }

  /** Short display label for a provider (used in the switch divider). */
  private getProviderShortLabel(providerId: ProviderId): string {
    try {
      return ProviderRegistry.getProviderDisplayName(providerId);
    } catch {
      return providerId;
    }
  }

  /**
   * Stamps the message element with `data-message-provider` and per-message
   * brand color CSS variables (`--message-brand`, `--message-brand-rgb`).
   * CSS rules in `message-provider.css` consume these to color the bubble
   * border, header chip, and dot — independent of the container's active
   * provider.
   */
  private applyMessageProvider(msg: ChatMessage, msgEl: HTMLElement): ProviderId {
    const providerId = this.resolveMessageProvider(msg);
    msgEl.dataset.messageProvider = providerId;
    msgEl.dataset.providerLabel = msg.agentLabel ?? this.getProviderShortLabel(providerId);
    if (msg.agentModel) msgEl.dataset.modelLabel = msg.agentModel;
    // `style.setProperty` may be absent in lightweight test stubs; guard so
    // the brand color never blocks message rendering.
    if (typeof msgEl.style?.setProperty === 'function') {
      msgEl.style.setProperty('--message-brand', `var(--claudian-brand-${providerId}, var(--claudian-brand))`);
      msgEl.style.setProperty(
        '--message-brand-rgb',
        `var(--claudian-brand-${providerId}-rgb, var(--claudian-brand-rgb))`,
      );
    }
    return providerId;
  }

  /**
   * Renders a centered "From ● Provider → ● Provider" divider between two
   * messages when their providers differ. Both dots pick up the corresponding
   * brand color via `--message-brand` set on each side element.
   */
  private renderProviderSwitchDivider(
    prevProvider: ProviderId,
    prevLabel: string,
    nextProvider: ProviderId,
    nextLabel: string,
  ): HTMLElement {
    const dividerEl = this.messagesEl.createDiv({ cls: 'claudian-provider-switch' });
    dividerEl.dataset.fromProvider = prevProvider;
    dividerEl.dataset.toProvider = nextProvider;

    dividerEl.createDiv({ cls: 'claudian-provider-switch-line' });

    const chipEl = dividerEl.createDiv({ cls: 'claudian-provider-switch-chip' });
    chipEl.setAttribute('role', 'separator');
    chipEl.setAttribute('aria-label', `${prevLabel} → ${nextLabel}`);

    const fromEl = chipEl.createSpan({ cls: 'claudian-provider-switch-side claudian-provider-switch-from' });
    if (typeof fromEl.style?.setProperty === 'function') {
      fromEl.style.setProperty(
        '--message-brand',
        `var(--claudian-brand-${prevProvider}, var(--claudian-brand))`,
      );
      fromEl.style.setProperty(
        '--message-brand-rgb',
        `var(--claudian-brand-${prevProvider}-rgb, var(--claudian-brand-rgb))`,
      );
    }
    fromEl.createSpan({ cls: 'claudian-provider-switch-dot' });
    fromEl.createSpan({ cls: 'claudian-provider-switch-label', text: prevLabel });

    chipEl.createSpan({ cls: 'claudian-provider-switch-arrow', text: '→' });

    const toEl = chipEl.createSpan({ cls: 'claudian-provider-switch-side claudian-provider-switch-to' });
    if (typeof toEl.style?.setProperty === 'function') {
      toEl.style.setProperty(
        '--message-brand',
        `var(--claudian-brand-${nextProvider}, var(--claudian-brand))`,
      );
      toEl.style.setProperty(
        '--message-brand-rgb',
        `var(--claudian-brand-${nextProvider}-rgb, var(--claudian-brand-rgb))`,
      );
    }
    toEl.createSpan({ cls: 'claudian-provider-switch-dot' });
    toEl.createSpan({ cls: 'claudian-provider-switch-label', text: nextLabel });

    dividerEl.createDiv({ cls: 'claudian-provider-switch-line' });

    return dividerEl;
  }

  /**
   * Inserts a provider-switch divider before rendering `msg` if its provider
   * differs from the previously rendered message's provider. Updates the
   * `lastRenderedProviderId` cursor to `msg`'s provider so subsequent
   * messages compare against this one. Returns the provider id of `msg`.
   */
  private maybeRenderSwitchDivider(msg: ChatMessage): ProviderId {
    const nextProvider = this.resolveMessageProvider(msg);
    const prev = this.lastRenderedProviderId;
    if (prev !== null && prev !== nextProvider) {
      const prevLabel = this.getProviderShortLabel(prev);
      const nextLabel = msg.agentLabel ?? this.getProviderShortLabel(nextProvider);
      this.renderProviderSwitchDivider(prev, prevLabel, nextProvider, nextLabel);
    }
    this.lastRenderedProviderId = nextProvider;
    return nextProvider;
  }

  // ============================================
  // Streaming Message Rendering
  // ============================================

  /**
   * Adds a new message to the chat during streaming.
   * Returns the message element for content updates.
   */
  addMessage(msg: ChatMessage): HTMLElement {
    // Render images above message bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      this.renderMessageAttachments(this.messagesEl, msg.attachments);
    }

    // Skip empty bubble for image-only messages
    if (msg.role === 'user') {
      const presentation = this.getUserMessagePresentation(msg);
      if (!presentation.text && !presentation.vaultContext && !presentation.memoryContext) {
        this.scrollToBottom();
        const lastChild = this.messagesEl.lastElementChild as HTMLElement;
        return lastChild ?? this.messagesEl;
      }
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    // Per-message provider branding: stamp brand color CSS vars on the
    // element so the bubble keeps its original provider's color even after
    // the user switches providers mid-conversation. Also insert a divider
    // when this message's provider differs from the previously rendered one.
    this.maybeRenderSwitchDivider(msg);
    this.applyMessageProvider(msg, msgEl);

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'assistant') {
      this.renderAssistantHeader(msg, msgEl, true);
    }

    if (msg.role === 'user') {
      const presentation = this.getUserMessagePresentation(msg);
      if (presentation.vaultContext || presentation.memoryContext) {
        this.renderInjectedContextCard(
          contentEl,
          presentation.vaultContext,
          presentation.memoryContext,
        );
      }
      if (presentation.text) {
        const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
        void this.renderContent(textEl, presentation.text);
        this.addUserCopyButton(msgEl, presentation.text);
      }
      if (this.rewindCallback || this.forkCallback) {
        this.liveMessageEls.set(msg.id, msgEl);
      }
    }

    this.scrollToBottom();
    return msgEl;
  }

  updateLiveUserMessage(msg: ChatMessage): void {
    if (msg.role !== 'user') {
      return;
    }

    const msgEl = this.liveMessageEls.get(msg.id)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) {
      return;
    }

    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');
    if (!contentEl) {
      return;
    }

    contentEl.empty();

    const presentation = this.getUserMessagePresentation(msg);
    if (presentation.vaultContext || presentation.memoryContext) {
      this.renderInjectedContextCard(
        contentEl,
        presentation.vaultContext,
        presentation.memoryContext,
      );
    }
    if (presentation.text) {
      const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
      void this.renderContent(textEl, presentation.text);
    }

    const toolbar = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (toolbar) {
      toolbar.querySelectorAll('.claudian-user-msg-copy-btn').forEach((el) => el.remove());
    }

    if (presentation.text) {
      this.addUserCopyButton(msgEl, presentation.text);
    }
  }

  removeMessage(messageId: string): void {
    const msgEl = this.liveMessageEls.get(messageId)
      ?? this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!msgEl) {
      return;
    }

    msgEl.remove();
    this.liveMessageEls.delete(messageId);
  }

  // ============================================
  // Stored Message Rendering (Batch/Replay)
  // ============================================

  /**
   * Renders all messages for conversation load/switch.
   * @param messages Array of messages to render
   * @param getGreeting Function to get greeting text
   * @returns The newly created welcome element
   */
  renderMessages(
    messages: ChatMessage[],
    getGreeting: () => string
  ): HTMLElement {
    this.messagesEl.empty();
    this.liveMessageEls.clear();
    // Reset the switch-divider cursor so the first rendered message never
    // gets a leading divider. As messages stream in, each one updates the
    // cursor via applyMessageProvider().
    this.lastRenderedProviderId = null;

    // Recreate welcome element after clearing
    const newWelcomeEl = this.messagesEl.createDiv({ cls: 'claudian-welcome' });
    newWelcomeEl.createDiv({ cls: 'claudian-welcome-greeting', text: getGreeting() });

    for (let i = 0; i < messages.length; i++) {
      this.renderStoredMessage(messages[i], messages, i);
    }

    this.scrollToBottom();
    return newWelcomeEl;
  }

  renderStoredMessage(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    // Bare interrupt marker: user-role interrupts (Claude bracket markers) always render
    // as a standalone indicator. Assistant-role interrupts (Codex partial responses)
    // only use the bare marker when there's no content to preserve.
    if (msg.isInterrupt && (msg.role === 'user' || !this.hasVisibleContent(msg))) {
      this.renderInterruptMessage();
      return;
    }

    // Skip rebuilt context messages (history sent to SDK on session reset)
    // These are internal context for the AI, not actual user messages to display
    if (msg.isRebuiltContext) {
      return;
    }

    // Render images above bubble for user messages
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      this.renderMessageImages(this.messagesEl, msg.images);
    }
    if (msg.role === 'user' && msg.attachments && msg.attachments.length > 0) {
      this.renderMessageAttachments(this.messagesEl, msg.attachments);
    }

    // Skip empty bubble for image-only messages
    const userPresentation = msg.role === 'user' ? this.getUserMessagePresentation(msg) : null;
    if (msg.role === 'user') {
      if (!userPresentation?.text && !userPresentation?.vaultContext && !userPresentation?.memoryContext) {
        return;
      }
    }
    if (msg.role === 'assistant' && !this.hasVisibleContent(msg)) {
      return;
    }

    const msgEl = this.messagesEl.createDiv({
      cls: `claudian-message claudian-message-${msg.role}`,
      attr: {
        'data-message-id': msg.id,
        'data-role': msg.role,
      },
    });

    // Per-message provider branding (see addMessage for rationale).
    this.maybeRenderSwitchDivider(msg);
    this.applyMessageProvider(msg, msgEl);

    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });

    if (msg.role === 'user') {
      if (userPresentation?.vaultContext || userPresentation?.memoryContext) {
        this.renderInjectedContextCard(
          contentEl,
          userPresentation.vaultContext,
          userPresentation.memoryContext,
        );
      }
      if (userPresentation?.text) {
        const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
        void this.renderContent(textEl, userPresentation.text);
        this.addUserCopyButton(msgEl, userPresentation.text);
      }
      if (msg.userMessageId && this.isRewindEligible(allMessages, index)) {
        if (this.rewindCallback) {
          this.addRewindButton(msgEl, msg.id);
        }
        if (this.forkCallback) {
          this.addForkButton(msgEl, msg.id);
        }
      }
    } else if (msg.role === 'assistant') {
      this.renderAssistantContent(msg, contentEl);
      if (msg.isInterrupt) {
        this.appendInterruptIndicator(contentEl);
      }
      this.renderAssistantHeader(msg, msgEl, false);
    }
  }

  private formatMessageTime(timestamp: number): string {
    return new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  private renderAssistantHeader(msg: ChatMessage, msgEl: HTMLElement, isStreaming: boolean): void {
    const existing = msgEl.querySelector<HTMLElement>('.claudian-assistant-turn-header');
    existing?.remove();
    const headerEl = msgEl.createDiv({ cls: 'claudian-assistant-turn-header' });
    headerEl.toggleClass('is-streaming', isStreaming);

    const identityEl = headerEl.createDiv({ cls: 'claudian-assistant-turn-identity' });
    identityEl.createSpan({ cls: 'claudian-assistant-turn-dot', attr: { 'aria-hidden': 'true' } });
    identityEl.createSpan({
      cls: 'claudian-assistant-turn-provider',
      text: msg.agentLabel ?? this.getProviderShortLabel(this.resolveMessageProvider(msg)),
    });
    if (msg.agentModel) {
      identityEl.createSpan({ cls: 'claudian-assistant-turn-model', text: msg.agentModel });
    }

    const statusEl = headerEl.createDiv({ cls: 'claudian-assistant-turn-status' });
    // While streaming, the live state is already shown by the StreamStatusBar
    // (progress bar + timer + Stop button), so the redundant "Live" badge in
    // the card corner is intentionally omitted. The completed state keeps its
    // useful check + timestamp.
    if (!isStreaming) {
      setIcon(statusEl.createSpan({ cls: 'claudian-assistant-turn-done' }), 'check');
      statusEl.createSpan({ text: this.formatMessageTime(msg.timestamp) });
    }
  }

  /** Promotes a live assistant card to its stable completed state. */
  finalizeLiveAssistantMessage(msg: ChatMessage): void {
    const msgEl = this.messagesEl.querySelector<HTMLElement>(`[data-message-id="${msg.id}"]`);
    if (!msgEl) return;
    this.renderAssistantHeader(msg, msgEl, false);
    const contentEl = msgEl.querySelector<HTMLElement>('.claudian-message-content');
    if (contentEl) this.renderAssistantFooter(msg, contentEl);
  }

  private hasVisibleContent(msg: ChatMessage): boolean {
    if (msg.content && msg.content.trim().length > 0) return true;
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      for (const block of msg.contentBlocks) {
        if (block.type === 'thinking' && block.content.trim().length > 0) return true;
        if (block.type === 'text' && block.content.trim().length > 0) return true;
        if (block.type === 'context_compacted') return true;
        if (block.type === 'subagent') return true;
        if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall && this.shouldRenderToolCall(toolCall)) return true;
        }
      }
    }
    if (msg.toolCalls?.some(toolCall => this.shouldRenderToolCall(toolCall))) return true;
    return false;
  }

  private isRewindEligible(allMessages?: ChatMessage[], index?: number): boolean {
    if (!allMessages || index === undefined) return false;
    const ctx = findRewindContext(allMessages, index);
    return !!ctx.prevAssistantUuid && ctx.hasResponse;
  }

  private renderInterruptMessage(): void {
    const msgEl = this.messagesEl.createDiv({ cls: 'claudian-message claudian-message-assistant' });
    const contentEl = msgEl.createDiv({ cls: 'claudian-message-content', attr: { dir: 'auto' } });
    this.appendInterruptIndicator(contentEl);
  }

  private appendInterruptIndicator(contentEl: HTMLElement): void {
    const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
    textEl.createSpan({ cls: 'claudian-interrupted', text: 'Interrupted' });
    textEl.appendText(' ');
    textEl.createSpan({
      cls: 'claudian-interrupted-hint',
      text: '\u00B7 What should Claudian do instead?',
    });
  }

  /**
   * Renders assistant message content (content blocks or fallback).
   */
  private renderAssistantContent(msg: ChatMessage, contentEl: HTMLElement): void {
    if (msg.contentBlocks && msg.contentBlocks.length > 0) {
      const renderedToolIds = new Set<string>();
      for (let blockIndex = 0; blockIndex < msg.contentBlocks.length; blockIndex += 1) {
        const block = msg.contentBlocks[blockIndex];
        if (block.type === 'thinking') {
          renderStoredThinkingBlock(
            contentEl,
            block.content,
            block.durationSeconds,
            (el, md) => this.renderContent(el, md)
          );
        } else if (block.type === 'text') {
          // Skip empty or whitespace-only text blocks to avoid extra gaps
          if (!block.content || !block.content.trim()) {
            continue;
          }
          const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
          void this.renderContent(textEl, block.content);
          this.addTextCopyButton(textEl, block.content);
        } else if (block.type === 'tool_use') {
          const toolCall = msg.toolCalls?.find(tc => tc.id === block.toolId);
          if (toolCall) {
            const groupedRun: ToolCallInfo[] = [];
            let nextIndex = blockIndex;
            while (nextIndex < msg.contentBlocks.length) {
              const candidateBlock = msg.contentBlocks[nextIndex];
              if (candidateBlock.type !== 'tool_use') break;
              const candidate = msg.toolCalls?.find(tc => tc.id === candidateBlock.toolId);
              if (!candidate || !LOW_SIGNAL_STORED_TOOLS.has(candidate.name.toLowerCase())) break;
              if (this.shouldRenderToolCall(candidate)) groupedRun.push(candidate);
              renderedToolIds.add(candidate.id);
              nextIndex += 1;
            }

            if (shouldGroupStoredToolCalls(groupedRun)) {
              this.renderStoredToolGroup(contentEl, groupedRun, msg);
              blockIndex = nextIndex - 1;
            } else {
              this.renderToolCall(contentEl, toolCall, msg);
              renderedToolIds.add(toolCall.id);
            }
          }
        } else if (block.type === 'context_compacted') {
          const boundaryEl = contentEl.createDiv({ cls: 'claudian-compact-boundary' });
          boundaryEl.createSpan({ cls: 'claudian-compact-boundary-label', text: 'Conversation compacted' });
        } else if (block.type === 'subagent') {
          const taskToolCall = msg.toolCalls?.find(
            tc => tc.id === block.subagentId && isSubagentToolName(tc.name)
          );
          if (!taskToolCall) continue;

          this.renderTaskSubagent(contentEl, taskToolCall, block.mode);
          renderedToolIds.add(taskToolCall.id);
        }
      }

      // Defensive fallback: preserve tool visibility when contentBlocks/toolCalls drift on reload.
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const toolCall of msg.toolCalls) {
          if (renderedToolIds.has(toolCall.id)) continue;
          this.renderToolCall(contentEl, toolCall, msg);
          renderedToolIds.add(toolCall.id);
        }
      }
    } else {
      // Fallback for old conversations without contentBlocks
      if (msg.content) {
        const textEl = contentEl.createDiv({ cls: 'claudian-text-block' });
        void this.renderContent(textEl, msg.content);
        this.addTextCopyButton(textEl, msg.content);
      }
      if (msg.toolCalls) {
        const visibleTools = msg.toolCalls.filter((toolCall) => this.shouldRenderToolCall(toolCall));
        if (shouldGroupStoredToolCalls(visibleTools)) {
          this.renderStoredToolGroup(contentEl, visibleTools, msg);
        } else {
          for (const toolCall of visibleTools) {
            this.renderToolCall(contentEl, toolCall, msg);
          }
        }
      }
    }

    // Render response telemetry and actions (skip compaction boundaries).
    const hasCompactBoundary = msg.contentBlocks?.some(b => b.type === 'context_compacted');
    if (!hasCompactBoundary) this.renderAssistantFooter(msg, contentEl);
  }

  private getAssistantCopyContent(msg: ChatMessage): string {
    if (msg.content.trim()) return msg.content.trim();
    return msg.contentBlocks
      ?.filter((block): block is Extract<NonNullable<ChatMessage['contentBlocks']>[number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.content.trim())
      .filter(Boolean)
      .join('\n\n') ?? '';
  }

  private renderAssistantFooter(msg: ChatMessage, contentEl: HTMLElement): void {
    const copyContent = this.getAssistantCopyContent(msg);
    const metrics = getAssistantMessageMetrics({ ...msg, content: copyContent });
    const footerEl = contentEl.querySelector<HTMLElement>('.claudian-response-footer')
      ?? contentEl.createDiv({ cls: 'claudian-response-footer' });
    footerEl.empty();

    if (msg.durationSeconds && msg.durationSeconds > 0) {
      const flavorWord = msg.durationFlavorWord || 'Baked';
      footerEl.createSpan({
        cls: 'claudian-baked-duration',
        text: `${flavorWord} · ${formatDurationMmSs(msg.durationSeconds)}`,
      });
    }

    const telemetryEl = footerEl.createDiv({ cls: 'claudian-response-telemetry' });
    const wordsEl = telemetryEl.createSpan({ cls: 'claudian-response-metric' });
    setIcon(wordsEl.createSpan(), 'text');
    wordsEl.createSpan({ text: `${metrics.words.toLocaleString('de-DE')} Wörter` });
    if (metrics.tools > 0) {
      const toolsEl = telemetryEl.createSpan({ cls: 'claudian-response-metric' });
      setIcon(toolsEl.createSpan(), 'wrench');
      toolsEl.createSpan({ text: `${metrics.tools} ${metrics.tools === 1 ? 'Werkzeug' : 'Werkzeuge'}` });
    }

    const actionsEl = footerEl.createDiv({ cls: 'claudian-response-actions' });
    if (copyContent) this.addAssistantCopyButton(actionsEl, copyContent);
    if (copyContent) this.addAssistantExportButton(actionsEl, msg);
    this.addSwitchModelButton(actionsEl);
  }

  private addAssistantCopyButton(actionsEl: HTMLElement, content: string): void {
    const btn = actionsEl.createEl('button', { cls: 'claudian-response-action' });
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Gesamte antwort kopieren');
    const iconEl = btn.createSpan();
    setIcon(iconEl, 'copy');
    const labelEl = btn.createSpan({ text: 'Kopieren' });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      runRendererAction(async () => {
        await navigator.clipboard.writeText(content);
        setIcon(iconEl, 'check');
        labelEl.setText('Kopiert');
        window.setTimeout(() => {
          setIcon(iconEl, 'copy');
          labelEl.setText('Kopieren');
        }, CODE_COPY_FEEDBACK_MS);
      });
    });
  }

  private addAssistantExportButton(actionsEl: HTMLElement, msg: ChatMessage): void {
    const btn = actionsEl.createEl('button', { cls: 'claudian-response-action' });
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Antwort als Obsidian-Notiz speichern');
    setIcon(btn.createSpan(), 'file-down');
    btn.createSpan({ text: 'Als Notiz' });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      runRendererAction(async () => {
        const path = await exportAssistantResponse(this.app.vault, msg);
        new Notice(`Antwort gespeichert: ${path}`);
      });
    });
  }

  /**
   * "Continue with another model": a one-click affordance on a completed assistant
   * message that opens the model picker and switches the conversation's provider in
   * place (recent context carries over via the one-shot bootstrap).
   */
  private addSwitchModelButton(footerEl: HTMLElement): void {
    if (!this.switchModelCallback) return;
    const btn = footerEl.createEl('button', { cls: 'claudian-response-action claudian-switch-model-btn' });
    setIcon(btn.createSpan(), 'arrow-left-right');
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Mit anderem modell weiter');
    btn.createSpan({ text: 'Modell wechseln', cls: 'claudian-switch-model-label' });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.switchModelCallback?.();
    });
  }

  /**
   * Renders a tool call with special handling for Write/Edit, Agent (subagent),
   * and Codex collab agent lifecycle tools.
   */
  private renderToolCall(contentEl: HTMLElement, toolCall: ToolCallInfo, msg?: ChatMessage): void {
    if (!this.shouldRenderToolCall(toolCall)) return;
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);

    if (isWriteEditTool(toolCall.name)) {
      renderStoredWriteEdit(contentEl, toolCall, {
        initiallyExpanded: this.shouldExpandFileEditsByDefault(),
      });
    } else if (isSubagentToolName(toolCall.name)) {
      this.renderTaskSubagent(contentEl, toolCall);
    } else if (subagentLifecycleAdapter?.isSpawnTool(toolCall.name) && msg) {
      this.renderProviderLifecycleSubagent(contentEl, toolCall, msg);
    } else {
      renderStoredToolCall(contentEl, toolCall, {
        initiallyExpanded: toolCall.name === TOOL_APPLY_PATCH && this.shouldExpandFileEditsByDefault(),
      });
    }
  }

  private renderStoredToolGroup(
    contentEl: HTMLElement,
    toolCalls: ToolCallInfo[],
    msg: ChatMessage,
  ): void {
    const groupEl = contentEl.createEl('details', { cls: 'claudian-tool-run-group' });
    const hasError = toolCalls.some((toolCall) => toolCall.status === 'error' || toolCall.status === 'blocked');
    const isRunning = toolCalls.some((toolCall) => toolCall.status === 'running');
    groupEl.toggleClass('has-error', hasError);
    groupEl.toggleClass('is-running', isRunning);

    const summaryEl = groupEl.createEl('summary', { cls: 'claudian-tool-run-summary' });
    const iconEl = summaryEl.createSpan({ cls: 'claudian-tool-run-icon' });
    setIcon(iconEl, 'terminal-square');
    const titleEl = summaryEl.createSpan({ cls: 'claudian-tool-run-title' });
    titleEl.createSpan({ text: `${toolCalls.length} Ausführungen` });

    const counts = new Map<string, number>();
    toolCalls.forEach((toolCall) => counts.set(toolCall.name, (counts.get(toolCall.name) ?? 0) + 1));
    titleEl.createSpan({
      cls: 'claudian-tool-run-breakdown',
      text: Array.from(counts, ([name, count]) => `${count}× ${name}`).join(' · '),
    });

    const statusEl = summaryEl.createSpan({ cls: 'claudian-tool-run-status' });
    setIcon(statusEl, hasError ? 'alert-triangle' : isRunning ? 'loader-circle' : 'check');
    statusEl.setAttribute(
      'aria-label',
      hasError ? 'Mindestens eine Ausführung fehlgeschlagen' : isRunning ? 'Ausführungen laufen' : 'Alle Ausführungen abgeschlossen',
    );
    const chevronEl = summaryEl.createSpan({ cls: 'claudian-tool-run-chevron' });
    setIcon(chevronEl, 'chevron-down');

    const bodyEl = groupEl.createDiv({ cls: 'claudian-tool-run-body' });
    bodyEl.createDiv({ cls: 'claudian-tool-run-loading', text: 'Details beim Öffnen laden …' });
    let hydrated = false;
    groupEl.addEventListener('toggle', () => {
      if (!groupEl.open || hydrated) return;
      hydrated = true;
      bodyEl.empty();
      for (const toolCall of toolCalls) this.renderToolCall(bodyEl, toolCall, msg);
    });
  }

  private shouldRenderToolCall(toolCall: ToolCallInfo): boolean {
    if (toolCall.name === TOOL_AGENT_OUTPUT) return false;
    if (toolCall.name === TOOL_WRITE_STDIN && this.isSilentWriteStdinTool(toolCall)) return false;
    if (toolCall.name === 'custom_tool_call_output') return false;

    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(toolCall.name);
    if (subagentLifecycleAdapter?.isHiddenTool(toolCall.name)) return false;

    return true;
  }

  private isSilentWriteStdinTool(toolCall: ToolCallInfo): boolean {
    return typeof toolCall.input.chars !== 'string' || toolCall.input.chars.length === 0;
  }

  private renderTaskSubagent(
    contentEl: HTMLElement,
    toolCall: ToolCallInfo,
    modeHint?: 'sync' | 'async'
  ): void {
    const subagentInfo = this.resolveTaskSubagent(toolCall, modeHint);
    if (subagentInfo.mode === 'async') {
      renderStoredAsyncSubagent(contentEl, subagentInfo);
      return;
    }
    renderStoredSubagent(contentEl, subagentInfo);
  }

  /**
   * Consolidates provider lifecycle tools (spawn + wait/close)
   * into a single subagent block with prompt and result.
   */
  private renderProviderLifecycleSubagent(
    contentEl: HTMLElement,
    spawnToolCall: ToolCallInfo,
    msg: ChatMessage,
  ): void {
    const subagentLifecycleAdapter = this.getSubagentLifecycleAdapter(spawnToolCall.name);
    if (!subagentLifecycleAdapter) {
      renderStoredToolCall(contentEl, spawnToolCall);
      return;
    }

    const subagentInfo = subagentLifecycleAdapter.buildSubagentInfo(
      spawnToolCall,
      msg.toolCalls ?? [],
    );
    renderStoredSubagent(contentEl, subagentInfo);
  }

  private resolveTaskSubagent(toolCall: ToolCallInfo, modeHint?: 'sync' | 'async'): SubagentInfo {
    if (toolCall.subagent) {
      if (!modeHint || toolCall.subagent.mode === modeHint) {
        return toolCall.subagent;
      }
      return {
        ...toolCall.subagent,
        mode: modeHint,
      };
    }

    const description = (toolCall.input?.description as string) || 'Subagent task';
    const prompt = (toolCall.input?.prompt as string) || '';
    const mode = modeHint ?? (toolCall.input?.run_in_background === true ? 'async' : 'sync');

    if (mode !== 'async') {
      return {
        id: toolCall.id,
        description,
        prompt,
        status: this.mapToolStatusToSubagentStatus(toolCall.status),
        toolCalls: [],
        isExpanded: false,
        result: toolCall.result,
      };
    }

    const asyncStatus = this.inferAsyncStatusFromTaskTool(toolCall);
    return {
      id: toolCall.id,
      description,
      prompt,
      mode: 'async',
      status: asyncStatus,
      asyncStatus,
      toolCalls: [],
      isExpanded: false,
      result: toolCall.result,
    };
  }

  private mapToolStatusToSubagentStatus(
    status: ToolCallInfo['status']
  ): 'completed' | 'error' | 'running' {
    switch (status) {
      case 'completed':
        return 'completed';
      case 'error':
      case 'blocked':
        return 'error';
      default:
        return 'running';
    }
  }

  private inferAsyncStatusFromTaskTool(toolCall: ToolCallInfo): 'running' | 'completed' | 'error' {
    if (toolCall.status === 'error' || toolCall.status === 'blocked') return 'error';
    if (toolCall.status === 'running') return 'running';

    const lowerResult = extractToolResultContent(toolCall.result, { fallbackIndent: 2 }).toLowerCase();
    if (
      lowerResult.includes('not_ready') ||
      lowerResult.includes('not ready') ||
      lowerResult.includes('"status":"running"') ||
      lowerResult.includes('"status":"pending"') ||
      lowerResult.includes('"retrieval_status":"running"') ||
      lowerResult.includes('"retrieval_status":"not_ready"')
    ) {
      return 'running';
    }

    return 'completed';
  }

  // ============================================
  // Image Rendering
  // ============================================

  /**
   * Renders image attachments above a message.
   */
  renderMessageImages(containerEl: HTMLElement, images: ImageAttachment[]): void {
    const imagesEl = containerEl.createDiv({ cls: 'claudian-message-images' });

    images.forEach((image, index) => {
      const imageWrapper = imagesEl.createDiv({ cls: 'claudian-message-image' });
      imageWrapper.setAttribute('role', 'button');
      imageWrapper.setAttribute('tabindex', '0');
      imageWrapper.setAttribute('aria-label', `${image.name} in Großansicht öffnen`);
      const imgEl = imageWrapper.createEl('img', {
        attr: {
          alt: image.name,
          loading: 'lazy',
          decoding: 'async',
        },
      });

      void this.setImageSrc(imgEl, image);

      // Click to view full size
      imgEl.addEventListener('click', () => {
        if (images.length > 1) {
          this.showFullImage(image, images, index);
        } else {
          this.showFullImage(image);
        }
      });
      imageWrapper.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (images.length > 1) {
            this.showFullImage(image, images, index);
          } else {
            this.showFullImage(image);
          }
        }
      });
    });
  }

  /**
   * Renders staged file attachments above a user message. Videos and audio get
   * inline players (you can literally watch what the agent is analyzing);
   * everything else renders as a compact file card.
   */
  renderMessageAttachments(containerEl: HTMLElement, attachments: MessageAttachment[]): void {
    const wrap = containerEl.createDiv({ cls: 'claudian-message-attachments' });

    for (const attachment of attachments) {
      const meta = attachmentTypeMeta(attachment.name);
      const card = wrap.createDiv({
        cls: `claudian-message-attachment claudian-message-attachment--${meta.kind}`,
      });

      if (meta.kind === 'video' || meta.kind === 'audio') {
        let resourcePath: string | null;
        try {
          resourcePath = this.app.vault.adapter.getResourcePath(attachment.relPath);
        } catch {
          resourcePath = null;
        }
        if (resourcePath) {
          const media = card.createEl(meta.kind, {
            attr: { src: resourcePath, controls: 'true', preload: 'metadata' },
          });
          media.addClass('claudian-message-attachment-media');
        }
      }

      const info = card.createDiv({ cls: 'claudian-message-attachment-info' });
      const iconEl = info.createSpan({ cls: 'claudian-message-attachment-icon' });
      setIcon(iconEl, meta.icon);
      const nameEl = info.createSpan({ cls: 'claudian-message-attachment-name' });
      nameEl.setText(attachment.name);
      nameEl.setAttribute('title', attachment.relPath);
      info.createSpan({
        cls: 'claudian-message-attachment-kind',
        text: meta.typeClass.toUpperCase(),
      });
    }
  }

  /**
   * Shows full-size image in modal overlay.
   */
  showFullImage(
    image: ImageAttachment,
    gallery: ImageAttachment[] = [image],
    initialIndex = 0,
  ): void {
    const ownerDocument = this.messagesEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });
    const imageEl = modal.createEl('img', {
      attr: {
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
    closeBtn.setText('\u00D7');

    const caption = modal.createDiv({ cls: 'claudian-image-modal-caption' });
    let activeIndex = Math.max(0, Math.min(initialIndex, gallery.length - 1));
    let showRequestToken = 0;
    const showAt = (index: number) => {
      activeIndex = (index + gallery.length) % gallery.length;
      const requestToken = ++showRequestToken;
      const activeImage = gallery[activeIndex];
      imageEl.setAttribute('alt', activeImage.name);
      caption.setText(gallery.length > 1
        ? `${activeImage.name} · ${activeIndex + 1} von ${gallery.length}`
        : activeImage.name);
      // `image.data` may have been cleared by save() to free memory. Resolve
      // the bytes (from the durable archive if needed) before setting src so
      // the modal never renders a `data:...;base64,` URI with empty data.
      modal.classList.add('is-loading');
      void this.resolveImageData(activeImage).then((resolved) => {
        // Stale request (user already navigated on) or modal already closed.
        if (requestToken !== showRequestToken || overlay.isConnected === false) return;
        modal.classList.remove('is-loading');
        if (resolved) {
          modal.classList.remove('has-error');
          imageEl.setAttribute('src', `data:${resolved.mediaType};base64,${resolved.data}`);
        } else {
          modal.classList.add('has-error');
          imageEl.removeAttribute('src');
          caption.setText(`${activeImage.name} — Bild nicht mehr verfügbar`);
        }
      });
    };
    showAt(activeIndex);

    if (gallery.length > 1) {
      const previous = modal.createDiv({ cls: 'claudian-image-modal-nav claudian-image-modal-nav--previous' });
      previous.setText('‹');
      previous.setAttribute('aria-label', 'Vorheriges Bild');
      previous.addEventListener('click', (event) => {
        event.stopPropagation();
        showAt(activeIndex - 1);
      });

      const next = modal.createDiv({ cls: 'claudian-image-modal-nav claudian-image-modal-nav--next' });
      next.setText('›');
      next.setAttribute('aria-label', 'Nächstes Bild');
      next.addEventListener('click', (event) => {
        event.stopPropagation();
        showAt(activeIndex + 1);
      });
    }

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      } else if (gallery.length > 1 && e.key === 'ArrowLeft') {
        showAt(activeIndex - 1);
      } else if (gallery.length > 1 && e.key === 'ArrowRight') {
        showAt(activeIndex + 1);
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  /**
   * Sets image src from attachment data, restoring cleared bytes on demand.
   */
  async setImageSrc(imgEl: HTMLImageElement, image: ImageAttachment): Promise<void> {
    const resolved = await this.resolveImageData(image);
    if (resolved) {
      imgEl.setAttribute('src', `data:${resolved.mediaType};base64,${resolved.data}`);
    } else {
      imgEl.removeAttribute('src');
      imgEl.closest?.('.claudian-message-image')?.classList.add('is-unavailable');
    }
  }

  /**
   * Returns the attachment with populated base64 data. `save()` clears
   * `image.data` on stored messages to free memory while rendered messages
   * still reference those exact objects — so empty data is an expected state,
   * recoverable from the durable image archive via the attachment id. The
   * restored bytes are cached back onto the attachment for later renders.
   */
  private async resolveImageData(image: ImageAttachment): Promise<ImageAttachment | null> {
    if (image.data) return image;
    try {
      const restored = await this.plugin.imageStagingService?.loadImage(image.id);
      if (restored?.data) {
        image.data = restored.data;
        return image;
      }
    } catch {
      // Archive unavailable — fall through to the unavailable state.
    }
    return null;
  }

  // ============================================
  // Content Rendering
  // ============================================

  /**
   * Renders markdown content with code block enhancements.
   */
  async renderContent(
    el: HTMLElement,
    markdown: string,
    options?: RenderContentOptions
  ): Promise<void> {
    el.empty();

    // Error/notice marker blocks render as a designed status card (clear title,
    // explanation, actionable hint, collapsible raw details) instead of a bare
    // red line. Same path serves live streaming and reloaded history.
    const statusCard = detectStatusCard(markdown);
    if (statusCard) {
      renderStatusCard(el, statusCard);
      return;
    }

    try {
      const renderMarkdown = options?.deferMath
        ? escapeMathDelimitersForStreaming(markdown)
        : markdown;
      // Normalize embeds before MarkdownRenderer consumes them.
      const processedMarkdown = replaceImageEmbedsWithHtml(
        renderMarkdown,
        this.app,
        { mediaFolder: this.plugin.settings.mediaFolder }
      );
      await MarkdownRenderer.render(
        this.app,
        processedMarkdown,
        el,
        '',
        this.component
      );

      // Network/FortiGate troubleshooting gets a live visual topology for
      // explicit `network-map` fences (prose inference was removed — it kept
      // rendering half-guessed maps under unrelated answers).
      renderNetworkMaps(el, renderMarkdown, {
        app: this.app,
        mediaFolder: this.plugin.settings.mediaFolder,
      });

      // Claude-style live document canvas. The document fence is replaced with
      // a designed page that updates on every streaming render and offers theme,
      // copy, save-to-vault, and full-screen controls.
      await renderLiveDocuments(el, renderMarkdown, {
        app: this.app,
        component: this.component,
      });

      // Short email requests get a dedicated mail preview with subject,
      // recipient, highlighted placeholders, copy, and save controls.
      await renderEmailTemplates(el, renderMarkdown, {
        app: this.app,
        component: this.component,
      });

      // Skill Creator fences render as a designed SKILL.md card with copy and
      // save-to-.claude/skills controls.
      await renderSkillCards(el, renderMarkdown, {
        app: this.app,
        component: this.component,
      });

      // Auto-Memory fences render as a compact chip instead of raw code.
      renderAutoMemoryChips(el);

      // Wrap pre elements and move buttons outside scroll area
      el.querySelectorAll('pre').forEach((pre) => {
        // Skip if already wrapped
        if (pre.parentElement?.classList.contains('claudian-code-wrapper')) return;

        // Create wrapper
        const wrapper = createEl('div', { cls: 'claudian-code-wrapper' });
        pre.parentElement?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        // Detect language from the highlighted <code> class (e.g. language-ts).
        const code = pre.querySelector('code[class*="language-"]');
        const match = code?.className.match(/language-([\w#+.-]+)/);
        const language = match ? match[1] : null;
        if (language) {
          wrapper.classList.add('has-language');
        }

        // Premium header bar: language label + working Copy button.
        addCodeBlockHeader(wrapper, pre, language);

        // Obsidian's own copy button is redundant now — drop it.
        pre.querySelector('.copy-code-button')?.remove();
      });

      // Normalize Obsidian wikilinks and rendered Markdown links that target
      // vault files. Providers like Antigravity emit normal Markdown links
      // (`/02-Projekte/...`) instead of `[[wikilinks]]`, so include both forms
      // while still skipping the DOM pass for plain text.
      if (containsPotentialVaultLink(processedMarkdown)) {
        processFileLinks(this.app, el);
      }
    } catch {
      el.createDiv({
        cls: 'claudian-render-error',
        text: 'Failed to render message content.',
      });
    }
  }

  // ============================================
  // Copy Button
  // ============================================

  /**
   * Adds a copy button to a text block.
   * Button shows clipboard icon on hover, changes to "copied!" on click.
   * @param textEl The rendered text element
   * @param markdown The original markdown content to copy
   */
  addTextCopyButton(textEl: HTMLElement, markdown: string): void {
    const copyBtn = textEl.createSpan({ cls: 'claudian-text-copy-btn' });
    setIcon(copyBtn, 'copy');

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {

        try {
          await navigator.clipboard.writeText(markdown);
        } catch {
          // Clipboard API may fail in non-secure contexts
          return;
        }

        // Clear any pending timeout from rapid clicks
        if (feedbackTimeout) {
          window.clearTimeout(feedbackTimeout);
        }

        // Show "copied!" feedback
        copyBtn.empty();
        copyBtn.setText('Kopiert');
        copyBtn.classList.add('copied');

        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  refreshActionButtons(msg: ChatMessage, allMessages?: ChatMessage[], index?: number): void {
    if (!msg.userMessageId) return;
    if (!this.isRewindEligible(allMessages, index)) return;
    const msgEl = this.liveMessageEls.get(msg.id);
    if (!msgEl) return;

    if (this.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn')) {
      this.addRewindButton(msgEl, msg.id);
    }
    if (this.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn')) {
      this.addForkButton(msgEl, msg.id);
    }
    this.cleanupLiveMessageEl(msg.id, msgEl);
  }

  private cleanupLiveMessageEl(msgId: string, msgEl: HTMLElement): void {
    const needsRewind = this.rewindCallback && !msgEl.querySelector('.claudian-message-rewind-btn');
    const needsFork = this.forkCallback && !msgEl.querySelector('.claudian-message-fork-btn');
    if (!needsRewind && !needsFork) {
      this.liveMessageEls.delete(msgId);
    }
  }

  private getOrCreateActionsToolbar(msgEl: HTMLElement): HTMLElement {
    const existing = msgEl.querySelector<HTMLElement>('.claudian-user-msg-actions');
    if (existing) return existing;
    return msgEl.createDiv({ cls: 'claudian-user-msg-actions' });
  }

  private addUserCopyButton(msgEl: HTMLElement, content: string): void {
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const copyBtn = toolbar.createSpan({ cls: 'claudian-user-msg-copy-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttribute('aria-label', 'Nachricht kopieren');

    let feedbackTimeout: number | null = null;

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await navigator.clipboard.writeText(content);
        } catch {
          return;
        }
        if (feedbackTimeout) window.clearTimeout(feedbackTimeout);
        copyBtn.empty();
        copyBtn.setText('Kopiert');
        copyBtn.classList.add('copied');
        feedbackTimeout = window.setTimeout(() => {
          copyBtn.empty();
          setIcon(copyBtn, 'copy');
          copyBtn.classList.remove('copied');
          feedbackTimeout = null;
        }, 1500);
      });
    });
  }

  private addRewindButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsRewind) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-rewind-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'rotate-ccw');
    btn.setAttribute('aria-label', t('chat.rewind.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.showRewindMenu(e, messageId);
    });
  }

  private showRewindMenu(event: MouseEvent, messageId: string): void {
    const menu = new Menu();
    this.addRewindMenuItem(menu, messageId, 'conversation');
    this.addRewindMenuItem(menu, messageId, 'code-and-conversation');
    menu.showAtMouseEvent(event);
  }

  private addRewindMenuItem(menu: Menu, messageId: string, mode: ChatRewindMode): void {
    menu.addItem((item) => {
      item
        .setTitle(
          mode === 'conversation'
            ? t('chat.rewind.menuConversationOnly')
            : t('chat.rewind.menuCodeAndConversation')
        )
        .setIcon(mode === 'conversation' ? 'message-square' : 'rotate-ccw')
        .onClick(() => {
          runRendererAction(async () => {
            try {
              await this.rewindCallback?.(messageId, mode);
            } catch (err) {
              new Notice(t('chat.rewind.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
            }
          });
        });
    });
  }

  private addForkButton(msgEl: HTMLElement, messageId: string): void {
    if (!this.getCapabilities().supportsFork) return;
    const toolbar = this.getOrCreateActionsToolbar(msgEl);
    const btn = toolbar.createSpan({ cls: 'claudian-message-fork-btn' });
    if (toolbar.firstChild !== btn) toolbar.insertBefore(btn, toolbar.firstChild);
    setIcon(btn, 'git-fork');
    btn.setAttribute('aria-label', t('chat.fork.ariaLabel'));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      runRendererAction(async () => {
        try {
          await this.forkCallback?.(messageId);
        } catch (err) {
          new Notice(t('chat.fork.failed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
      });
    });
  }

  // ============================================
  // Utilities
  // ============================================

  /** Scrolls messages container to bottom. */
  scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  /** Scrolls to bottom if already near bottom (within threshold). */
  scrollToBottomIfNeeded(threshold = 100): void {
    const { scrollTop, scrollHeight, clientHeight } = this.messagesEl;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < threshold;
    if (isNearBottom) {
      window.requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }
  }

}
