import type { ProviderCapabilities } from '../../../core/providers/types';
import { buildEstimatedUsageInfo } from '../../../core/providers/usage/estimateUsage';
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
import type { ChatMessage, Conversation, SlashCommand, StreamChunk, ToolCallInfo } from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { FREEBUFF_PROVIDER_CAPABILITIES } from '../capabilities';
import { FREEBUFF_PROVIDER_ID, getFreebuffProviderSettings } from '../settings';
import { buildPersistedFreebuffState, type FreebuffProviderState, getFreebuffState } from '../types';
import { getFreebuffModelContextWindow } from '../types/models';
import { FreebuffOrchestratorClient } from './FreebuffOrchestratorClient';
import { type FreebuffBusEvent, type FreebuffFinishMetrics, FreebuffSseParser } from './FreebuffSseParser';
import { FREEBUFF_KEEPALIVE_INTERVAL_MS, FREEBUFF_KEEPALIVE_MAX_SILENCE_MS } from './keepalive';

/**
 * HTTP/SSE runtime for the Freebuff desktop app.
 *
 * Turns are threads in the running desktop app: the runtime posts the user
 * message to `POST /api/thread/:id/message` and consumes the orchestrator's
 * SSE bus (`GET /api/events`) filtered to that thread. The bus replays recent
 * history on connect, which both covers the post-then-connect race and lets
 * reconnects resume mid-turn via a per-thread seq watermark.
 */
export class FreebuffChatRuntime implements ChatRuntime {
  readonly providerId = FREEBUFF_PROVIDER_ID;

  private state: FreebuffProviderState = {};
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly client = new FreebuffOrchestratorClient();
  private activeAbort: AbortController | null = null;
  private activeThreadId: string | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return FREEBUFF_PROVIDER_CAPABILITIES;
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
    this.state = conversation ? getFreebuffState(conversation.providerState) : {};
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getFreebuffProviderSettings(settingsBag);
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }
    const port = await this.client.discoverPort(settings.orchestratorPort);
    this.setReady(port !== null);
    return port !== null;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    _queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getFreebuffProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Freebuff ist deaktiviert. Aktiviere es in den Einstellungen.' };
      yield { type: 'done' };
      return;
    }

    const port = await this.client.discoverPort(settings.orchestratorPort);
    if (port === null) {
      yield { type: 'error', content: 'Freebuff Desktop läuft nicht. Starte die Freebuff-App und versuche es erneut.' };
      yield { type: 'done' };
      return;
    }

    const promptText = turn.request.text.trim();
    if (!promptText) {
      yield { type: 'error', content: 'Leere Nachricht.' };
      yield { type: 'done' };
      return;
    }

    // Reuse the conversation's thread; create one lazily on the first turn.
    let threadId = this.state.threadId;
    if (!threadId) {
      const projectPath = settings.projectPath || getVaultPath(this.plugin.app) || process.cwd();
      const created = await this.client.createThread(port, {
        projectPath,
        title: promptText.slice(0, 60),
        // The API rejects a model without its harness (live verified:
        // model alone -> "invalid model"), so always pair the two.
        harnessId: 'codebuff',
        model: settings.model,
      });
      if (!created?.id) {
        yield { type: 'error', content: 'Konnte keinen Freebuff-Thread erstellen.' };
        yield { type: 'done' };
        return;
      }
      threadId = created.id;
      this.state = { ...this.state, threadId };
    }
    this.activeThreadId = threadId;

    yield { type: 'user_message_start', content: turn.request.text };

    // Post first, connect second: the bus replays what already happened, so
    // events emitted before the stream opens are not lost.
    const accepted = await this.client.postMessage(port, threadId, promptText);
    if (!accepted) {
      this.activeThreadId = null;
      yield { type: 'error', content: 'Freebuff hat die Nachricht nicht angenommen (Thread geschlossen oder App beendet?).' };
      yield { type: 'done' };
      return;
    }

    const abort = new AbortController();
    this.activeAbort = abort;
    const parser = new FreebuffSseParser();
    const pendingChunks: StreamChunk[] = [];
    let wake: (() => void) | null = null;
    const signal = (): void => {
      const resume = wake;
      wake = null;
      resume?.();
    };

    let lastSeq = this.state.lastSeq ?? -1;
    let sawFinish = false;
    let sawError = false;
    let errorMessage = '';
    // Holder object instead of a plain let: TypeScript narrows a closure-
    // mutated let back to its initializer at the read site below.
    const turnResult: { finish?: FreebuffFinishMetrics } = {};
    const startedAtMs = Date.now();
    let lastActivityAtMs = startedAtMs;

    const keepaliveTimer = window.setInterval(() => {
      if (Date.now() - lastActivityAtMs > FREEBUFF_KEEPALIVE_MAX_SILENCE_MS) {
        abort.abort();
        return;
      }
      pendingChunks.push({ type: 'keepalive' });
      signal();
    }, FREEBUFF_KEEPALIVE_INTERVAL_MS);

    const handleBusEvent = (busEvent: FreebuffBusEvent): void => {
      if (busEvent.type !== 'agent' || busEvent.threadId !== threadId) {
        return;
      }
      if (typeof busEvent.seq === 'number') {
        if (busEvent.seq <= lastSeq) {
          return;
        }
        lastSeq = busEvent.seq;
      }
      const inner = busEvent.event;
      if (!inner?.type) {
        return;
      }
      lastActivityAtMs = Date.now();
      switch (inner.type) {
        case 'text': {
          const text = typeof inner.text === 'string' ? inner.text : '';
          if (text) {
            pendingChunks.push({ type: 'text', content: text });
          }
          break;
        }
        case 'reasoning_delta': {
          const reasoning = typeof inner.text === 'string' ? inner.text : '';
          if (reasoning) {
            pendingChunks.push({ type: 'thinking', content: reasoning });
          }
          break;
        }
        case 'finish': {
          turnResult.finish = (inner.metrics ?? undefined) as FreebuffFinishMetrics | undefined;
          sawFinish = true;
          abort.abort();
          break;
        }
        default:
          break;
      }
      signal();
    };

    try {
      const response = await this.client.openEventStream(port, abort.signal);
      if (!response?.body) {
        throw new Error('event stream unavailable');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      const pump = (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            for (const busEvent of parser.push(decoder.decode(value, { stream: true }))) {
              handleBusEvent(busEvent);
            }
          }
        } catch {
          // Aborted or transport dropped; the main loop decides below.
        }
      })();

      while (true) {
        while (pendingChunks.length > 0) {
          const chunk = pendingChunks.shift() as StreamChunk;
          yield chunk;
        }
        if (sawFinish || abort.signal.aborted || !this.activeAbort) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      await pump.catch(() => undefined);
    } catch (error) {
      sawError = true;
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      window.clearInterval(keepaliveTimer);
      this.activeAbort = null;
      this.activeThreadId = null;
      this.state = { ...this.state, lastSeq };
    }

    if (!sawFinish && !sawError && abort.signal.aborted) {
      // Watchdog timeout or user cancel without a stop call landing yet.
      await this.client.stopTurn(port, threadId);
      yield { type: 'notice', content: 'Freebuff-Turn abgebrochen.', level: 'warning' };
    }

    if (sawError) {
      yield { type: 'error', content: `Freebuff-Verbindung fehlgeschlagen: ${errorMessage}` };
      yield { type: 'done' };
      return;
    }

    if (!sawFinish) {
      yield { type: 'error', content: 'Freebuff hat den Turn ohne Abschluss beendet.' };
      yield { type: 'done' };
      return;
    }

    this.currentTurnMetadata.wasSent = true;

    const metrics = turnResult.finish ?? null;
    const usage = metrics?.usage;
    const observedWindow = metrics?.context?.compactionThresholdTokens;
    const contextWindow = typeof observedWindow === 'number' && observedWindow > 0
      ? observedWindow
      : getFreebuffModelContextWindow(settings.model);
    const usedTokens = typeof metrics?.context?.usedTokens === 'number'
      ? metrics.context.usedTokens
      : typeof usage?.totalTokens === 'number'
        ? usage.totalTokens
        : undefined;

    if (usage && typeof usedTokens === 'number') {
      yield {
        type: 'usage',
        usage: {
          model: settings.model,
          inputTokens: typeof usage.inputTokens === 'number' ? usage.inputTokens : 0,
          cacheReadInputTokens: typeof usage.cachedInputTokens === 'number' ? usage.cachedInputTokens : 0,
          outputTokens: typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
          contextWindow,
          contextWindowIsAuthoritative: typeof observedWindow === 'number' && observedWindow > 0,
          contextTokens: usedTokens,
          percentage: Math.min(100, Math.round((usedTokens / contextWindow) * 100)),
        },
        sessionId: threadId,
      };
    } else {
      const contextTokens = buildEstimatedUsageInfo({
        contextTokens: 0,
        contextWindow,
        model: settings.model,
      }).contextTokens;
      yield {
        type: 'usage',
        usage: buildEstimatedUsageInfo({
          contextTokens,
          contextWindow,
          model: settings.model,
        }),
        sessionId: threadId,
      };
    }
    yield { type: 'done' };
  }

  cancel(): void {
    const threadId = this.activeThreadId;
    const abort = this.activeAbort;
    if (abort) {
      abort.abort();
    }
    if (threadId !== null) {
      const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
      const settings = getFreebuffProviderSettings(settingsBag);
      void this.client.discoverPort(settings.orchestratorPort).then((port) => {
        if (port !== null) {
          return this.client.stopTurn(port, threadId);
        }
        return undefined;
      }).catch(() => undefined);
    }
  }

  async softSteer(_turn: PreparedChatTurn): Promise<boolean> {
    this.cancel();
    return true;
  }

  resetSession(): void {
    this.state = {};
  }

  getSessionId(): string | null {
    return this.state.threadId ?? null;
  }

  consumeSessionInvalidation(): boolean {
    return false;
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
    void params;
    if (!this.state.threadId) {
      return { updates: { providerState: undefined, sessionId: null } };
    }
    return {
      updates: {
        providerState: buildPersistedFreebuffState(this.state),
        sessionId: this.state.threadId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.state.threadId ?? getFreebuffState(conversation?.providerState).threadId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      return;
    }
    this.ready = ready;
    for (const listener of this.readyListeners) {
      listener(ready);
    }
  }
}