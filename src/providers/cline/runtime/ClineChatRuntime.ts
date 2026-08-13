import * as path from 'node:path';

import { appendImagePathReferences } from '../../../core/providers/imagePathFallback';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
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
  ToolCallInfo,
} from '../../../core/types';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  type AcpClientConnectionDelegate,
  type AcpContentBlock,
  AcpJsonRpcTransport,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionModeId,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
} from '../../acp';
import { CLINE_PROVIDER_CAPABILITIES } from '../capabilities';
import { resolveClineModelSelection } from '../modelOptions';
import { createClineAcpToolStreamAdapter } from '../normalization/clineAcpToolNormalization';
import { CLINE_PROVIDER_ID,getClineProviderSettings } from '../settings';
import { buildPersistedClineState, type ClineProviderState,getClineState } from '../types';
import { buildClineLaunchSpec } from './ClineLaunchSpec';
import { buildClineRuntimeEnv } from './ClineRuntimeEnvironment';
import { CLINE_KEEPALIVE_INTERVAL_MS, CLINE_KEEPALIVE_MAX_SILENCE_MS } from './keepalive';

interface ActiveTurn {
  queue: StreamChunkQueue;
  sessionId: string;
}

class StreamChunkQueue {
  private closed = false;
  private readonly items: StreamChunk[] = [];
  private readonly waiters: Array<(chunk: StreamChunk | null) => void> = [];

  push(chunk: StreamChunk): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(chunk);
      return;
    }
    this.items.push(chunk);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.(null);
    }
  }

  async next(): Promise<StreamChunk | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise<StreamChunk | null>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class ClineChatRuntime implements ChatRuntime {
  readonly providerId = CLINE_PROVIDER_ID;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private autoTurnCallback: AutoTurnCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private currentLaunchKey: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private cwd: string = process.cwd();
  private exitPlanModeCallback: ExitPlanModeCallback | null = null;
  private lastNotificationAt = 0;
  private loadedSessionId: string | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private process: AcpSubprocess | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private readonly supportedCommands: SlashCommand[] = [];
  private readonly toolStreamAdapter = createClineAcpToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return CLINE_PROVIDER_CAPABILITIES;
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
    const state = getClineState(conversation.providerState);
    this.sessionId = state.sessionId ?? null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getClineProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }

    const command = this.plugin.getResolvedProviderCliPath(CLINE_PROVIDER_ID);
    if (!command) {
      this.setReady(false);
      return false;
    }

    this.cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const cwd = this.cwd;
    const env = buildClineRuntimeEnv(
      this.plugin.settings as unknown as Record<string, unknown>,
      command,
    );
    const envText = getRuntimeEnvironmentText(
      this.plugin.settings as unknown as Record<string, unknown>,
      CLINE_PROVIDER_ID,
    );
    const model = resolveClineModelSelection(
      this.plugin.settings as unknown as Record<string, unknown>,
      typeof this.plugin.settings.model === 'string' ? this.plugin.settings.model : '',
    ) ?? '';

    const launchSpec = buildClineLaunchSpec({
      apiProvider: settings.apiProvider,
      command,
      cwd,
      env,
      envText,
      mode: 'acp',
      model,
      permissionMode: settings.permissionMode,
      thinking: settings.thinking,
    });

    const shouldRestart =
      !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== launchSpec.launchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      await this.startProcess(launchSpec);
      this.currentLaunchKey = launchSpec.launchKey;
      this.loadedSessionId = null;
    }

    const targetSessionId = this.sessionId;
    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId);
        if (!loaded) {
          this.sessionInvalidated = true;
          this.clearActiveSession();
        }
      }
      return true;
    }

    if (!this.sessionId && !this.sessionInvalidated) {
      if (options?.allowSessionCreation === false) {
        return true;
      }
      return Boolean(await this.createSession());
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    _conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    if (!(await this.ensureReady())) {
      yield { type: 'error', content: 'Cline ACP konnte nicht gestartet werden. CLI-Pfad und Login prüfen (`cline auth`).' };
      yield { type: 'done' };
      return;
    }

    if (!this.connection || !this.sessionId) {
      yield { type: 'error', content: 'Cline ACP ist nicht bereit.' };
      yield { type: 'done' };
      return;
    }

    const sessionId = this.sessionId;
    this.activeTurn?.queue.close();
    this.activeTurn = { queue: new StreamChunkQueue(), sessionId };
    this.currentTurnMetadata = {};
    this.sessionUpdateNormalizer.reset();
    this.toolStreamAdapter.reset();

    const activeTurn = this.activeTurn;

    try {
      await this.applyPermissionMode(sessionId);
      await this.applyModel(sessionId, queryOptions?.model);
      await this.applyThinking(sessionId);
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Cline-Sitzung konnte nicht konfiguriert werden.',
      };
      yield { type: 'done' };
      activeTurn.queue.close();
      this.activeTurn = null;
      return;
    }

    const promptBlocks: AcpContentBlock[] = [{
      text: appendImagePathReferences(turn.request.text, turn.request.images),
      type: 'text',
    }];
    for (const image of turn.request.images ?? []) {
      if (!image.data) continue;
      promptBlocks.push({ data: image.data, mimeType: image.mediaType, type: 'image' });
    }

    const promptPromise = this.connection
      .prompt({
        prompt: promptBlocks,
        sessionId,
      })
      .then((response) => {
        if (response.userMessageId) {
          this.currentTurnMetadata.userMessageId = response.userMessageId;
        }
        activeTurn.queue.push({ type: 'done' });
        activeTurn.queue.close();
      })
      .catch((error) => {
        activeTurn.queue.push({
          type: 'error',
          content: error instanceof Error ? error.message : 'Cline ACP Prompt fehlgeschlagen.',
        });
        activeTurn.queue.push({ type: 'done' });
        activeTurn.queue.close();
      })
      .finally(() => {
        if (this.activeTurn === activeTurn) {
          this.activeTurn = null;
        }
      });

    this.lastNotificationAt = Date.now();
    const keepaliveTimer = window.setInterval(() => {
      if (this.activeTurn !== activeTurn) {
        return;
      }
      if (Date.now() - this.lastNotificationAt > CLINE_KEEPALIVE_MAX_SILENCE_MS) {
        return;
      }
      activeTurn.queue.push({ type: 'keepalive' });
    }, CLINE_KEEPALIVE_INTERVAL_MS);

    try {
      while (true) {
        const chunk = await activeTurn.queue.next();
        if (!chunk) {
          break;
        }
        yield chunk;
      }
      await promptPromise;
    } finally {
      window.clearInterval(keepaliveTimer);
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    }
  }

  steer?(_turn: PreparedChatTurn): Promise<boolean> {
    return Promise.resolve(false);
  }

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
    if (this.activeTurn) {
      this.activeTurn.queue.close();
      this.activeTurn = null;
    }
  }

  resetSession(): void {
    this.clearActiveSession();
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  consumeSessionInvalidation(): boolean {
    const wasInvalidated = this.sessionInvalidated;
    this.sessionInvalidated = false;
    return wasInvalidated;
  }

  isReady(): boolean {
    return this.ready;
  }

  async getSupportedCommands(): Promise<SlashCommand[]> {
    return this.supportedCommands;
  }

  getAuxiliaryModel?(): string | null {
    return null;
  }

  cleanup(): void {
    void this.shutdownProcess();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Rewind wird von Cline ACP nicht unterstützt.' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }

  setExitPlanModeCallback(callback: ExitPlanModeCallback | null): void {
    this.exitPlanModeCallback = callback;
  }

  setPermissionModeSyncCallback(callback: ((mode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

  setSubagentHookProvider(_getState: () => SubagentRuntimeState): void {}

  setAutoTurnCallback(callback: AutoTurnCallback | null): void {
    this.autoTurnCallback = callback;
  }

  consumeTurnMetadata(): ChatTurnMetadata {
    const metadata = this.currentTurnMetadata;
    this.currentTurnMetadata = {};
    return metadata;
  }

  buildSessionUpdates(params: {
    conversation: Conversation | null;
    sessionInvalidated: boolean;
  }): SessionUpdateResult {
    const state: ClineProviderState = {
      sessionId: this.sessionId ?? undefined,
    };
    if (params.sessionInvalidated) {
      state.sessionId = undefined;
    }
    return {
      updates: {
        providerState: buildPersistedClineState(state),
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? getClineState(conversation?.providerState).sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  private async startProcess(launchSpec: ReturnType<typeof buildClineLaunchSpec>): Promise<void> {
    this.process = new AcpSubprocess({
      args: launchSpec.args,
      command: launchSpec.command,
      cwd: launchSpec.cwd,
      env: {
        ...launchSpec.env,
        PATH: getEnhancedPath(
          launchSpec.env.PATH,
          path.isAbsolute(launchSpec.command) ? launchSpec.command : undefined,
        ),
      },
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'ayontclaudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: this.buildDelegate(),
      transport: this.transport,
    });

    this.transport.start();
    await this.connection.initialize();
    this.setReady(true);
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.connection?.dispose();
    this.connection = null;
    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown();
      this.process = null;
    }
  }

  private async createSession(): Promise<string | null> {
    if (!this.connection) {
      return null;
    }
    try {
      const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
      const response = await this.connection.newSession({ cwd, mcpServers: [] });
      const sessionId = response.sessionId ?? null;
      if (sessionId) {
        this.sessionId = sessionId;
        this.loadedSessionId = sessionId;
      }
      return sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string): Promise<boolean> {
    if (!this.connection) {
      return false;
    }
    try {
      const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
      await this.connection.loadSession({ cwd, mcpServers: [], sessionId });
      this.sessionId = sessionId;
      this.loadedSessionId = sessionId;
      return true;
    } catch {
      return false;
    }
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.sessionInvalidated = false;
  }

  private async applyPermissionMode(sessionId: string): Promise<void> {
    const settings = getClineProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    const mode: AcpSessionModeId = settings.permissionMode === 'plan' ? 'plan' : 'act';
    try {
      await this.connection?.setMode({ modeId: mode, sessionId });
    } catch {
      // Cline ACP may expose `code` instead of `act`.
      if (mode === 'act') {
        try {
          await this.connection?.setMode({ modeId: 'code', sessionId });
        } catch {
          // Best-effort.
        }
      }
    }
  }

  private async applyModel(sessionId: string, model?: string): Promise<void> {
    const selected = model?.trim();
    if (!selected || !this.connection) {
      return;
    }
    try {
      await this.connection.setConfigOption({
        configId: 'model',
        sessionId,
        type: 'select',
        value: selected,
      });
    } catch {
      // Best-effort: not all ACP servers expose a model config option.
    }
  }

  private async applyThinking(sessionId: string): Promise<void> {
    const settings = getClineProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!this.connection) {
      return;
    }
    try {
      await this.connection.setConfigOption({
        configId: 'thinking',
        sessionId,
        type: 'select',
        value: settings.thinking,
      });
    } catch {
      // Best-effort.
    }
  }

  private buildDelegate(): AcpClientConnectionDelegate {
    return {
      onSessionNotification: (notification) => this.handleSessionNotification(notification),
      requestPermission: (request) => this.handlePermissionRequest(request),
    };
  }

  private async handleSessionNotification(notification: AcpSessionNotification): Promise<void> {
    const activeTurn = this.activeTurn;
    if (!activeTurn || activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    this.lastNotificationAt = Date.now();

    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);
    if (!normalized) {
      return;
    }

    switch (normalized.type) {
      case 'current_mode': {
        this.permissionModeSyncCallback?.(normalized.currentModeId);
        if (normalized.currentModeId === 'plan') {
          void this.exitPlanModeCallback?.({});
        }
        break;
      }
      case 'plan':
        break;
      case 'tool_call':
      case 'tool_call_update': {
        const streamChunks =
          normalized.type === 'tool_call'
            ? this.toolStreamAdapter.normalizeToolCall(normalized.toolCall, normalized.streamChunks)
            : this.toolStreamAdapter.normalizeToolCallUpdate(
              normalized.toolCallUpdate,
              normalized.streamChunks,
            );
        for (const chunk of streamChunks) {
          activeTurn.queue.push(chunk);
        }
        return;
      }
    }

    if ('streamChunks' in normalized) {
      for (const chunk of normalized.streamChunks) {
        activeTurn.queue.push(chunk);
      }
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    const allowOption = request.options.find((option) => option.kind === 'allow_once');

    if (!this.approvalCallback || !allowOption) {
      return {
        outcome: allowOption
          ? { optionId: allowOption.optionId, outcome: 'selected' }
          : { outcome: 'cancelled' },
      };
    }

    const decisionOptions = request.options.map((option) => ({
      description: option.kind,
      label: option.name,
      value: option.optionId,
    }));

    const decision = await this.approvalCallback(
      request.toolCall.kind ?? 'tool',
      isPlainObject(request.toolCall.rawInput)
        ? (request.toolCall.rawInput as Record<string, unknown>)
        : {},
      request.toolCall.title ?? 'Tool request',
      { decisionOptions },
    );

    if (!decision || decision === 'deny' || decision === 'cancel') {
      return { outcome: { outcome: 'cancelled' } };
    }

    if (decision === 'allow' || decision === 'allow-always') {
      return { outcome: { optionId: allowOption.optionId, outcome: 'selected' } };
    }

    return { outcome: { optionId: decision.value, outcome: 'selected' } };
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
