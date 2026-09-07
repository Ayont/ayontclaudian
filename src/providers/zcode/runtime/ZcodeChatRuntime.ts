import { expandProviderCommandInput } from '../../../core/providers/commands/expandProviderCommandInput';
import { appendImagePathReferences } from '../../../core/providers/imagePathFallback';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  ExitPlanModeCallback,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ChatMessage,
  Conversation,
  SlashCommand,
  StreamChunk,
  UsageInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { nodeFetch } from '../../../utils/nodeFetch';
import { ZCODE_PROVIDER_CAPABILITIES } from '../capabilities';
import { getZcodeModelContextWindow, resolveZcodeModelSelection } from '../modelOptions';
import {
  getZcodeProviderSettings,
  ZCODE_PROVIDER_ID,
  type ZcodeReasoningEffort,
} from '../settings';
import { buildPersistedZcodeState, getZcodeState, type ZcodeProviderState } from '../types';
import { DEFAULT_ZCODE_PRIMARY_MODEL } from '../types/models';
import { ZcodeCliResolver } from './ZcodeCliResolver';

interface ZcodeThinkingConfig {
  type: 'enabled';
  budget_tokens: number;
}

export class ZcodeChatRuntime implements ChatRuntime {
  readonly providerId = ZCODE_PROVIDER_ID;

  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeAbortController: AbortController | null = null;
  private readonly cliResolver = new ZcodeCliResolver();

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return ZCODE_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: request.text,
      request,
    };
  }

  onReadyStateChange(listener: (ready: boolean) => void): () => void {
    this.readyListeners.add(listener);
    return () => {
      this.readyListeners.delete(listener);
    };
  }

  setResumeCheckpoint(_checkpointId: string | undefined): void {}

  syncConversationState(conversation: ChatRuntimeConversationState | null): void {
    if (!conversation) {
      this.sessionId = null;
      this.sessionInvalidated = false;
      return;
    }
    const state = getZcodeState(conversation.providerState);
    this.sessionId = state.sessionId ?? conversation.sessionId ?? null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getZcodeProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    if (settings.mode === 'cli') {
      const isCliReady = Boolean(this.cliResolver.resolve(settings));
      this.setReady(isCliReady);
      return isCliReady;
    }

    // In API mode, check if API key exists
    const hasKey = Boolean(settings.apiKey.trim());
    this.setReady(hasKey);
    return hasKey;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.readyListeners) {
      try {
        listener(ready);
      } catch (err) {
        console.error('[ZCode] Ready state listener error:', err);
      }
    }
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getZcodeProviderSettings(settingsBag);

    if (!settings.enabled) {
      yield { type: 'error', content: 'ZCode ist deaktiviert. Aktiviere es in den Einstellungen.' };
      yield { type: 'done' };
      return;
    }

    const apiKey = settings.apiKey.trim();
    if (!apiKey) {
      yield {
        type: 'error',
        content:
          'Kein Z.ai API-Key gefunden. Bitte trage deinen Z.ai API-Key in den ZCode-Einstellungen ein oder starte ZCode einmal auf deinem Mac.',
      };
      yield { type: 'done' };
      return;
    }

    if (!this.sessionId) {
      this.sessionId = `zcode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    const rawModel =
      queryOptions?.model?.trim() ||
      resolveZcodeModelSelection(
        settingsBag,
        typeof settingsBag.model === 'string' ? settingsBag.model : '',
      ) ||
      DEFAULT_ZCODE_PRIMARY_MODEL;

    const normalizedModel = this.mapModelId(rawModel);
    const contextWindow = getZcodeModelContextWindow(rawModel);

    let promptText = turn.request.text;
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(ZCODE_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        promptText = expandProviderCommandInput(turn.request.text, entries);
      }
    } catch {
      promptText = turn.request.text;
    }
    promptText = appendImagePathReferences(promptText, turn.request.images);

    // Build messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of conversationHistory ?? []) {
      if ((msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        const clean = msg.content.trim();
        if (clean) {
          messages.push({ role: msg.role, content: clean });
        }
      }
    }
    messages.push({ role: 'user', content: promptText });

    const thinkingConfig = this.resolveThinkingConfig(
      settings.reasoningEffort,
      normalizedModel,
    );

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const cleanBase = settings.baseURL.replace(/\/+$/, "");
    const endpoint = cleanBase.endsWith("/v1")
      ? `${cleanBase}/messages`
      : `${cleanBase}/v1/messages`;
    const payload: Record<string, unknown> = {
      model: normalizedModel,
      max_tokens: 16384,
      stream: true,
      messages,
    };
    if (thinkingConfig) {
      payload.thinking = thinkingConfig;
    }

    let inputTokens = 0;
    let outputTokens = 0;

    const requestHeaders: Record<string, string> = {
      'x-api-key': apiKey,
      'authorization': `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'accept': 'text/event-stream',
    };

    try {
      const fetchImpl = process.env.NODE_ENV === 'test' && typeof window.fetch === 'function' ? window.fetch : nodeFetch;
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        yield {
          type: 'error',
          content: `Z.ai API Fehler (${response.status}): ${errorText || response.statusText}`,
        };
        yield { type: 'done' };
        return;
      }

      if (!response.body) {
        yield { type: 'error', content: 'Z.ai Antwort enthält keinen Stream-Body.' };
        yield { type: 'done' };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) {
            continue;
          }

          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') {
            break;
          }

          try {
            const event = JSON.parse(dataStr);
            const eventType = event?.type;

            if (eventType === 'message_start') {
              if (event.message?.usage?.input_tokens) {
                inputTokens = event.message.usage.input_tokens;
              }
            } else if (eventType === 'content_block_delta') {
              const delta = event.delta;
              if (delta?.type === 'thinking_delta' && delta.thinking) {
                yield { type: 'thinking', content: delta.thinking };
              } else if (delta?.type === 'text_delta' && delta.text) {
                yield { type: 'text', content: delta.text };
              }
            } else if (eventType === 'message_delta') {
              if (event.usage?.output_tokens) {
                outputTokens = event.usage.output_tokens;
              }
            } else if (eventType === 'error') {
              yield {
                type: 'error',
                content: event.error?.message ?? 'Unbekannter Z.ai Streaming-Fehler',
              };
            }
          } catch {
            // Ignore malformed JSON chunks in SSE stream
          }
        }
      }

      const contextTokens = inputTokens + outputTokens;
      const percentage = Math.min(100, Math.round((contextTokens / contextWindow) * 100));

      const usage: UsageInfo = {
        model: rawModel,
        inputTokens,
        outputTokens,
        contextWindow,
        contextTokens,
        percentage,
        reportType: 'final',
      };

      yield {
        type: 'usage',
        usage,
        sessionId: this.sessionId,
      };
      yield { type: 'done' };
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        yield { type: 'error', content: 'Anfrage abgebrochen.' };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        yield { type: 'error', content: `ZCode Verbindungsfehler: ${message}` };
      }
      yield { type: 'done' };
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

    private mapModelId(raw: string): string {
    const withoutPrefix = raw.replace(/^zcode\//i, "").trim();
    const lower = withoutPrefix.toLowerCase();
    if (lower === "glm-5.3") {
      return "glm-5.3";
    }
    if (lower === "glm-5.3-flash") {
      return "glm-5.3-flash";
    }
    if (lower === "glm-5-turbo") {
      return "glm-5-turbo";
    }
    return withoutPrefix;
  }

  private resolveThinkingConfig(
    effort: ZcodeReasoningEffort,
    model: string,
  ): ZcodeThinkingConfig | undefined {
    if (effort === 'off' || model === 'glm-5.3-flash') {
      return undefined;
    }
    let budget = 32000;
    if (effort === 'low') {
      budget = 4000;
    } else if (effort === 'high') {
      budget = 16000;
    } else if (effort === 'max') {
      budget = 32000;
    }
    return { type: 'enabled', budget_tokens: budget };
  }

  cancel(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  async softSteer(_turn: PreparedChatTurn): Promise<boolean> {
    this.cancel();
    return true;
  }

  resetSession(): void {
    this.sessionInvalidated = true;
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const invalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return invalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return [];
  }

  getAuxiliaryModel(): string | null {
    return null;
  }

  cleanup(): void {
    this.cancel();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false };
  }

  setApprovalCallback(_callback: ApprovalCallback | null): void {}
  setApprovalDismisser(_dismisser: (() => void) | null): void {}
  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}
  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}
  setPermissionModeSyncCallback(_callback: ((sdkMode: string) => void) | null): void {}
  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}
  setAutoTurnCallback(_callback: AutoTurnCallback | null): void {}

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    if (params.sessionInvalidated && !this.sessionId) {
      return { updates: { providerState: undefined, sessionId: null } };
    }
    const state: ZcodeProviderState = {
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    };
    return {
      updates: {
        providerState: buildPersistedZcodeState(state),
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return (
      this.sessionId ??
      getZcodeState(conversation?.providerState).sessionId ??
      null
    );
  }
}
