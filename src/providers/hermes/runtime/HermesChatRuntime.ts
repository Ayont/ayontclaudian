import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  buildSystemPrompt,
  computeSystemPromptKey,
  type SystemPromptSettings,
} from '../../../core/prompt/mainAgent';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderRegistry } from '../../../core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderCapabilities } from '../../../core/providers/types';
import type { ChatRuntime } from '../../../core/runtime/ChatRuntime';
import type {
  ApprovalCallback,
  ApprovalDecisionOption,
  AskUserQuestionCallback,
  AutoTurnCallback,
  ChatRewindMode,
  ChatRewindResult,
  ChatRuntimeConversationState,
  ChatRuntimeEnsureReadyOptions,
  ChatRuntimeQueryOptions,
  ChatTurnMetadata,
  ChatTurnRequest,
  PreparedChatTurn,
  SessionUpdateResult,
  SubagentRuntimeState,
} from '../../../core/runtime/types';
import type {
  ApprovalDecision,
  ChatMessage,
  Conversation,
  ExitPlanModeCallback,
  SlashCommand,
  StreamChunk,
  ToolCallInfo,
} from '../../../core/types';
import { normalizeWorkspaceMode } from '../../../core/workspace/workspaceMode';
import type ClaudianPlugin from '../../../main';
import { getEnhancedPath } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import {
  AcpClientConnection,
  AcpJsonRpcTransport,
  type AcpPermissionOption,
  type AcpReadTextFileRequest,
  type AcpRequestPermissionRequest,
  type AcpRequestPermissionResponse,
  type AcpSessionModelState,
  type AcpSessionModeState,
  type AcpSessionNotification,
  AcpSessionUpdateNormalizer,
  AcpSubprocess,
  type AcpUsage,
  type AcpUsageUpdate,
  type AcpWriteTextFileRequest,
  buildAcpUsageInfo,
  extractAcpSessionModelState,
  extractAcpSessionModeState,
} from '../../acp';
import { HERMES_PROVIDER_CAPABILITIES } from '../capabilities';
import { updateHermesDiscoveryState } from '../discoveryState';
import {
  sameHermesDiscoveredModels,
  sameHermesModes,
  sameStringList,
} from '../internal/compareCollections';
import { ensureProviderProjectionMap } from '../internal/providerProjection';
import {
  decodeHermesModelId,
  encodeHermesModelId,
  HERMES_SYNTHETIC_MODEL_ID,
  isHermesModelSelectionId,
  normalizeHermesDiscoveredModels,
} from '../models';
import {
  normalizeHermesAvailableModes,
  normalizeHermesSelectedMode,
  resolvePermissionModeForHermesMode,
} from '../modes';
import {
  createHermesToolStreamAdapter,
  enrichHermesToolCall,
} from '../normalization/hermesToolNormalization';
import {
  getHermesProviderSettings,
  HERMES_PROVIDER_ID,
  updateHermesProviderSettings,
} from '../settings';
import { buildPersistedHermesState, getHermesState } from '../types';
import { buildHermesPromptBlocks, buildHermesPromptText } from './buildHermesPrompt';
import { resolveHermesStateDbPath } from './HermesPaths';
import { buildHermesRuntimeEnv } from './HermesRuntimeEnvironment';
import { HERMES_KEEPALIVE_INTERVAL_MS, HERMES_KEEPALIVE_MAX_SILENCE_MS } from './keepalive';

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

export class HermesChatRuntime implements ChatRuntime {
  readonly providerId = HERMES_PROVIDER_ID;

  private activeTurn: ActiveTurn | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private connection: AcpClientConnection | null = null;
  private contextUsage: AcpUsageUpdate | null = null;
  private currentLaunchKey: string | null = null;
  private currentSessionModelId: string | null = null;
  private currentSessionModeId: string | null = null;
  private currentStatePath: string | null = null;
  private currentTurnMetadata: ChatTurnMetadata = {};
  /** Last wire activity, used to cap keepalive heartbeats. */
  private lastNotificationAt = 0;
  private loadedSessionId: string | null = null;
  private permissionModeSyncCallback: ((mode: string) => void) | null = null;
  private process: AcpSubprocess | null = null;
  private promptUsage: AcpUsage | null = null;
  private ready = false;
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  /** Whether the current turn produced any assistant text or tool activity. */
  private sawAssistantOutput = false;
  private sessionCwds = new Map<string, string>();
  private sessionId: string | null = null;
  private sessionInvalidated = false;
  private readonly sessionUpdateNormalizer = new AcpSessionUpdateNormalizer();
  private supportedCommands: SlashCommand[] = [];
  private readonly supportedCommandWaiters: Array<(commands: SlashCommand[]) => void> = [];
  private readonly toolStreamAdapter = createHermesToolStreamAdapter();
  private transport: AcpJsonRpcTransport | null = null;
  private unregisterTransportClose: (() => void) | null = null;
  /** Prompt key already sent to `vaultPromptSessionId`; re-sent when it changes. */
  private vaultPromptKey: string | null = null;
  private vaultPromptSessionId: string | null = null;

  constructor(private readonly plugin: ClaudianPlugin) {}

  getCapabilities(): Readonly<ProviderCapabilities> {
    return HERMES_PROVIDER_CAPABILITIES;
  }

  prepareTurn(request: ChatTurnRequest): PreparedChatTurn {
    return {
      isCompact: false,
      mcpMentions: request.enabledMcpServers ?? new Set(),
      persistedContent: '',
      prompt: buildHermesPromptText(request),
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
    // Only Hermes' own recorded id may reach `hermes acp`. The shared
    // `conversation.sessionId` can hold another provider's id after a mid-chat
    // switch, and Hermes answers an unknown id with an empty success — so a
    // foreign id would silently produce a `refusal` turn instead of an error.
    const state = getHermesState(conversation?.providerState);
    const nextSessionId = state.sessionId ?? null;

    if (this.sessionId !== nextSessionId) {
      this.currentSessionModelId = null;
      this.currentSessionModeId = null;
      this.sessionInvalidated = false;
      this.vaultPromptKey = null;
      this.vaultPromptSessionId = null;
      this.setSupportedCommands([]);
    }

    this.sessionId = nextSessionId;
    this.currentStatePath = state.statePath ?? null;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const hermesSettings = getHermesProviderSettings(settingsBag);
    if (!hermesSettings.enabled) {
      this.setReady(false);
      return false;
    }

    const command = this.plugin.getResolvedProviderCliPath(HERMES_PROVIDER_ID);
    if (!command) {
      this.setReady(false);
      return false;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const runtimeEnv = buildHermesRuntimeEnv(settingsBag, command);
    const nextLaunchKey = JSON.stringify({
      acceptHooks: hermesSettings.acceptHooks,
      command,
      cwd,
      envText: getRuntimeEnvironmentText(settingsBag, HERMES_PROVIDER_ID),
      yoloMode: hermesSettings.yoloMode,
    });

    const shouldRestart = !this.process
      || !this.transport
      || !this.connection
      || !this.process.isAlive()
      || this.transport.isClosed
      || options?.force === true
      || this.currentLaunchKey !== nextLaunchKey;

    if (shouldRestart) {
      await this.shutdownProcess();
      const started = await this.startProcess({
        acceptHooks: hermesSettings.acceptHooks,
        command,
        cwd,
        runtimeEnv,
      });
      if (!started) {
        return false;
      }
      this.currentLaunchKey = nextLaunchKey;
      this.loadedSessionId = null;
    }

    const targetSessionId = this.sessionId;
    if (targetSessionId) {
      if (this.loadedSessionId !== targetSessionId) {
        const loaded = await this.loadSession(targetSessionId, cwd);
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
      return Boolean(await this.createSession(cwd));
    }

    return true;
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    const previousMessages = conversationHistory ?? [];
    const expectedSessionId = this.sessionId;
    let shouldBootstrapHistory = previousMessages.length > 0
      && (!expectedSessionId || this.sessionInvalidated);

    if (!(await this.ensureReady())) {
      yield {
        type: 'error',
        content: 'Hermes konnte nicht gestartet werden. Bitte CLI-Pfad und `hermes acp --check` prüfen.',
      };
      yield { type: 'done' };
      return;
    }

    if (!this.connection) {
      yield { type: 'error', content: 'Die Hermes-Runtime ist nicht bereit.' };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    if (expectedSessionId && !this.sessionId) {
      shouldBootstrapHistory = previousMessages.length > 0;
    }

    if (!this.sessionId && !(await this.createSession(cwd))) {
      yield { type: 'error', content: 'Es konnte keine Hermes-Sitzung erstellt werden.' };
      yield { type: 'done' };
      return;
    }

    const sessionId = this.sessionId!;
    this.activeTurn?.queue.close();
    this.activeTurn = { queue: new StreamChunkQueue(), sessionId };
    this.currentTurnMetadata = {};
    this.contextUsage = null;
    this.promptUsage = null;
    this.sawAssistantOutput = false;
    this.sessionUpdateNormalizer.reset();
    this.toolStreamAdapter.reset();

    const activeTurn = this.activeTurn;
    try {
      await this.applySelectedMode(sessionId);
      await this.applySelectedModel(sessionId, queryOptions);
    } catch (error) {
      yield { type: 'error', content: this.formatRuntimeError(error) };
      yield { type: 'done' };
      activeTurn.queue.close();
      this.activeTurn = null;
      return;
    }

    const promptPromise = this.connection.prompt({
      prompt: buildHermesPromptBlocks({
        conversationHistory: shouldBootstrapHistory ? previousMessages : [],
        request: turn.request,
        ...(this.consumeVaultPrompt(sessionId, cwd, turn.request.text) ?? {}),
      }),
      sessionId,
    }).then((response) => {
      if (response.userMessageId) {
        this.currentTurnMetadata.userMessageId = response.userMessageId;
      }
      this.promptUsage = response.usage ?? null;

      // A turn that produced nothing must not look like a successful empty
      // answer. `refusal` is also what Hermes returns for a session it does not
      // know, so it doubles as the "session went away" signal.
      const stopReasonError = describeUnproductiveStopReason(
        response.stopReason,
        this.sawAssistantOutput,
      );
      if (stopReasonError) {
        if (response.stopReason === 'refusal' && !this.sawAssistantOutput) {
          // Drop the dead session right away; retrying `session/load` on it
          // would only burn another turn before landing on the same answer.
          this.clearActiveSession();
          this.sessionInvalidated = true;
        }
        activeTurn.queue.push({ type: 'error', content: stopReasonError });
      }

      if (!stopReasonError) {
        const usage = buildAcpUsageInfo({
          contextWindow: this.contextUsage,
          model: this.getActiveDisplayModel(queryOptions),
          promptUsage: this.promptUsage,
          reportType: 'final',
        });
        if (usage) {
          activeTurn.queue.push({ sessionId, type: 'usage', usage });
        }
      }

      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).catch((error) => {
      // A failed turn must not leave a half-applied preamble marked as sent.
      if (this.vaultPromptSessionId === sessionId) {
        this.vaultPromptKey = null;
        this.vaultPromptSessionId = null;
      }
      activeTurn.queue.push({ type: 'error', content: this.formatRuntimeError(error) });
      activeTurn.queue.push({ type: 'done' });
      activeTurn.queue.close();
    }).finally(() => {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
    });

    this.lastNotificationAt = Date.now();
    const keepaliveTimer = window.setInterval(() => {
      if (this.activeTurn !== activeTurn) {
        return;
      }
      if (Date.now() - this.lastNotificationAt > HERMES_KEEPALIVE_MAX_SILENCE_MS) {
        return;
      }
      activeTurn.queue.push({ type: 'keepalive' });
    }, HERMES_KEEPALIVE_INTERVAL_MS);

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

  cancel(): void {
    if (this.connection && this.sessionId) {
      this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  /**
   * Native mid-turn steer: Hermes' `/steer` command injects guidance into the
   * running turn (`AIAgent.steer`). It is only claimed while a turn is actually
   * in flight — with no active turn Hermes would silently move the text to its
   * own next-turn queue, which duplicates Claudian's queue.
   */
  async steer(turn: PreparedChatTurn): Promise<boolean> {
    const text = turn.request.text.trim();
    if (!this.connection || !this.sessionId || !this.activeTurn || !text) {
      return false;
    }

    try {
      await this.connection.prompt({
        prompt: [{ type: 'text', text: `/steer ${text}` }],
        sessionId: this.sessionId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async softSteer(_turn: PreparedChatTurn): Promise<boolean> {
    this.cancel();
    return true;
  }

  resetSession(): void {
    this.clearActiveSession();
    this.sessionInvalidated = false;
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
    if (this.supportedCommands.length > 0 && this.loadedSessionId === this.sessionId) {
      return [...this.supportedCommands];
    }

    if (this.sessionId && this.loadedSessionId !== this.sessionId) {
      if (!(await this.ensureReady({ allowSessionCreation: false }))) {
        return [];
      }
    }

    if (!this.sessionId || this.loadedSessionId !== this.sessionId) {
      return [...this.supportedCommands];
    }

    return this.waitForSupportedCommands();
  }

  getAuxiliaryModel(): string | null {
    return this.getActiveDisplayModel() ?? null;
  }

  cleanup(): void {
    this.activeTurn?.queue.close();
    void this.shutdownProcess();
  }

  async rewind(
    _userMessageId: string,
    _assistantMessageId: string,
    _mode?: ChatRewindMode,
  ): Promise<ChatRewindResult> {
    return { canRewind: false, error: 'Hermes unterstützt kein Rewind.' };
  }

  setApprovalCallback(callback: ApprovalCallback | null): void {
    this.approvalCallback = callback;
  }

  setApprovalDismisser(_dismisser: (() => void) | null): void {}

  setAskUserQuestionCallback(_callback: AskUserQuestionCallback | null): void {}

  setExitPlanModeCallback(_callback: ExitPlanModeCallback | null): void {}

  setPermissionModeSyncCallback(callback: ((sdkMode: string) => void) | null): void {
    this.permissionModeSyncCallback = callback;
  }

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
    const existingState = params.conversation
      ? getHermesState(params.conversation.providerState)
      : {};
    const statePath = this.currentStatePath ?? existingState.statePath;
    const updates: Partial<Conversation> = {
      providerState: buildPersistedHermesState({
        ...(this.sessionId ? { sessionId: this.sessionId } : {}),
        ...(statePath ? { statePath } : {}),
      }),
      sessionId: this.sessionId,
    };

    if (params.sessionInvalidated && !this.sessionId) {
      updates.providerState = undefined;
      updates.sessionId = null;
    }

    return { updates };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return this.sessionId ?? getHermesState(conversation?.providerState).sessionId ?? null;
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Process lifecycle
  // ---------------------------------------------------------------------------

  private async startProcess(params: {
    acceptHooks: boolean;
    command: string;
    cwd: string;
    runtimeEnv: NodeJS.ProcessEnv;
  }): Promise<boolean> {
    // `hermes acp` takes the workspace from `session/new`, not from a flag;
    // `--accept-hooks` is the only switch the subcommand itself accepts.
    const args = params.acceptHooks ? ['acp', '--accept-hooks'] : ['acp'];

    this.process = new AcpSubprocess({
      args,
      command: params.command,
      cwd: params.cwd,
      env: {
        ...params.runtimeEnv,
        PATH: getEnhancedPath(
          params.runtimeEnv.PATH,
          path.isAbsolute(params.command) ? params.command : undefined,
        ),
      },
    });
    this.process.start();

    this.transport = new AcpJsonRpcTransport({
      input: this.process.stdout,
      onClose: (listener) => this.process!.onClose(listener),
      output: this.process.stdin,
    });
    const transport = this.transport;
    this.unregisterTransportClose = transport.onClose(() => {
      if (this.transport === transport) {
        this.setReady(false);
      }
    });

    this.connection = new AcpClientConnection({
      clientInfo: {
        name: 'claudian',
        version: this.plugin.manifest?.version ?? '0.0.0',
      },
      delegate: {
        fileSystem: {
          readTextFile: (request) => this.readTextFile(request),
          writeTextFile: (request) => this.writeTextFile(request),
        },
        onSessionNotification: (notification) => this.handleSessionNotification(notification),
        requestPermission: (request) => this.handlePermissionRequest(request),
      },
      transport: this.transport,
    });

    this.transport.start();
    try {
      // Hermes boots plugin discovery and the credential pool before replying;
      // a cold start is slow but not broken, so failures here are surfaced as a
      // not-ready runtime rather than a thrown turn.
      await this.connection.initialize();
    } catch {
      await this.shutdownProcess();
      return false;
    }

    this.currentStatePath = resolveHermesStateDbPath(params.runtimeEnv);
    this.setReady(true);
    return true;
  }

  private async shutdownProcess(): Promise<void> {
    this.setReady(false);
    this.activeTurn?.queue.close();
    this.activeTurn = null;
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.setSupportedCommands([]);

    this.unregisterTransportClose?.();
    this.unregisterTransportClose = null;

    this.connection?.dispose();
    this.connection = null;

    this.transport?.dispose();
    this.transport = null;

    if (this.process) {
      await this.process.shutdown().catch(() => {});
      this.process = null;
    }
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

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  private async createSession(cwd: string): Promise<string | null> {
    if (!this.connection) {
      return null;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.newSession({ cwd, mcpServers: [] });
      this.loadedSessionId = response.sessionId;
      this.sessionId = response.sessionId;
      this.sessionCwds.set(response.sessionId, cwd);
      this.vaultPromptKey = null;
      this.vaultPromptSessionId = null;
      await this.syncSessionModelState({ models: response.models ?? null });
      await this.syncSessionModeState({ modes: response.modes ?? null });
      return response.sessionId;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string, cwd: string): Promise<boolean> {
    if (!this.connection) {
      return false;
    }

    try {
      this.setSupportedCommands([]);
      const response = await this.connection.loadSession({ cwd, mcpServers: [], sessionId });
      // An unknown session id is answered with a bare `{}` instead of an error
      // (verified against hermes-agent 0.20.5). A real load always carries the
      // session's model and mode state, so their absence is the failure signal.
      if (!response?.models && !response?.modes) {
        return false;
      }

      this.sessionInvalidated = false;
      this.loadedSessionId = response.sessionId ?? sessionId;
      this.sessionId = this.loadedSessionId;
      this.sessionCwds.set(this.loadedSessionId, cwd);
      await this.syncSessionModelState({ models: response.models ?? null });
      await this.syncSessionModeState({ modes: response.modes ?? null });
      return true;
    } catch {
      return false;
    }
  }

  private clearActiveSession(): void {
    this.sessionId = null;
    this.loadedSessionId = null;
    this.currentSessionModelId = null;
    this.currentSessionModeId = null;
    this.vaultPromptKey = null;
    this.vaultPromptSessionId = null;
    this.setSupportedCommands([]);
  }

  // ---------------------------------------------------------------------------
  // Model / mode selection
  // ---------------------------------------------------------------------------

  private getProviderSettings(): Record<string, unknown> {
    return ProviderSettingsCoordinator.getProviderSettingsSnapshot(
      this.plugin.settings,
      this.providerId,
    );
  }

  private resolveSelectedRawModelId(queryOptions?: ChatRuntimeQueryOptions): string | null {
    const providerSettings = this.getProviderSettings();
    const selectedModel = typeof queryOptions?.model === 'string'
      ? queryOptions.model
      : typeof providerSettings.model === 'string'
      ? providerSettings.model
      : '';

    if (!isHermesModelSelectionId(selectedModel)) {
      return null;
    }

    const rawModelId = decodeHermesModelId(selectedModel);
    if (!rawModelId) {
      return null;
    }

    // The discovered catalog is authoritative once it exists; before the first
    // successful session it is empty and any configured id is passed through.
    const discoveredModels = getHermesProviderSettings(providerSettings).discoveredModels;
    if (discoveredModels.length > 0 && !discoveredModels.some((model) => model.rawId === rawModelId)) {
      return null;
    }

    return rawModelId;
  }

  private getActiveDisplayModel(queryOptions?: ChatRuntimeQueryOptions): string | undefined {
    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (selectedRawModelId) {
      return encodeHermesModelId(selectedRawModelId);
    }

    return this.currentSessionModelId
      ? encodeHermesModelId(this.currentSessionModelId)
      : undefined;
  }

  private async applySelectedModel(
    sessionId: string,
    queryOptions?: ChatRuntimeQueryOptions,
  ): Promise<void> {
    const selectedRawModelId = this.resolveSelectedRawModelId(queryOptions);
    if (!this.connection || !selectedRawModelId || selectedRawModelId === this.currentSessionModelId) {
      return;
    }

    await this.connection.setModel({ modelId: selectedRawModelId, sessionId });
    this.currentSessionModelId = selectedRawModelId;
  }

  private async applySelectedMode(sessionId: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    const hermesSettings = getHermesProviderSettings(this.getProviderSettings());
    const selectedModeId = normalizeHermesSelectedMode(
      hermesSettings.selectedMode,
      hermesSettings.availableModes,
    );
    if (selectedModeId === this.currentSessionModeId) {
      return;
    }

    await this.connection.setMode({ modeId: selectedModeId, sessionId });
    this.currentSessionModeId = selectedModeId;
    this.emitPermissionModeSync(selectedModeId);
  }

  private async syncSessionModelState(params: {
    models?: AcpSessionModelState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModelState(params);
    if (acpState.currentModelId) {
      this.currentSessionModelId = acpState.currentModelId;
    }

    const discoveredModels = normalizeHermesDiscoveredModels(
      acpState.availableModels.map((model) => ({
        ...(model.description ? { description: model.description } : {}),
        label: model.name,
        rawId: model.id,
      })),
    );
    if (discoveredModels.length === 0) {
      return;
    }

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const currentSettings = getHermesProviderSettings(settingsBag);
    const discoveryChanged = !sameHermesDiscoveredModels(
      currentSettings.discoveredModels,
      discoveredModels,
    ) && updateHermesDiscoveryState(settingsBag, { discoveredModels });

    // Seed the visible list on first discovery so the picker is never empty.
    const seedRawId = this.currentSessionModelId ?? discoveredModels[0]?.rawId;
    const nextVisibleModels = currentSettings.visibleModels.length === 0 && seedRawId
      ? [seedRawId]
      : currentSettings.visibleModels;
    const shouldSeedVisibleModels = !sameStringList(
      currentSettings.visibleModels,
      nextVisibleModels,
    );
    if (shouldSeedVisibleModels) {
      updateHermesProviderSettings(settingsBag, { visibleModels: nextVisibleModels });
    }

    const seededSelection = seedRawId
      ? this.seedActiveModelSelection(settingsBag, encodeHermesModelId(seedRawId))
      : false;

    if (shouldSeedVisibleModels || seededSelection) {
      await this.plugin.saveSettings();
    }
    if (discoveryChanged || shouldSeedVisibleModels || seededSelection) {
      this.refreshModelSelectors();
    }
  }

  private seedActiveModelSelection(
    settingsBag: Record<string, unknown>,
    modelSelection: string,
  ): boolean {
    let changed = false;
    const savedProviderModel = ensureProviderProjectionMap(settingsBag, 'savedProviderModel');
    const savedModel = typeof savedProviderModel[HERMES_PROVIDER_ID] === 'string'
      ? savedProviderModel[HERMES_PROVIDER_ID]
      : '';
    if (!savedModel || savedModel === HERMES_SYNTHETIC_MODEL_ID) {
      savedProviderModel[HERMES_PROVIDER_ID] = modelSelection;
      changed = true;
    }

    if (ProviderRegistry.resolveSettingsProviderId(settingsBag) !== this.providerId) {
      return changed;
    }

    const activeModel = typeof settingsBag.model === 'string' ? settingsBag.model : '';
    if (!activeModel || activeModel === HERMES_SYNTHETIC_MODEL_ID) {
      settingsBag.model = modelSelection;
      changed = true;
    }
    return changed;
  }

  private async syncSessionModeState(params: {
    currentModeId?: string | null;
    modes?: AcpSessionModeState | null;
  }): Promise<void> {
    const acpState = extractAcpSessionModeState(params);
    const availableModes = normalizeHermesAvailableModes(acpState.availableModes);
    const currentModeId = params.currentModeId ?? acpState.currentModeId;
    if (currentModeId) {
      this.currentSessionModeId = currentModeId;
      this.emitPermissionModeSync(currentModeId);
    }

    if (availableModes.length === 0) {
      return;
    }

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const currentSettings = getHermesProviderSettings(settingsBag);
    const discoveryChanged = !sameHermesModes(currentSettings.availableModes, availableModes)
      && updateHermesDiscoveryState(settingsBag, { availableModes });
    if (!discoveryChanged) {
      return;
    }

    // Re-normalize the persisted choice against the freshly discovered list.
    const normalizedMode = normalizeHermesSelectedMode(currentSettings.selectedMode, availableModes);
    if (normalizedMode !== currentSettings.selectedMode) {
      updateHermesProviderSettings(settingsBag, { selectedMode: normalizedMode });
      await this.plugin.saveSettings();
    }
    this.refreshModelSelectors();
  }

  private emitPermissionModeSync(modeId: string): void {
    const permissionMode = resolvePermissionModeForHermesMode(modeId);
    if (!permissionMode || !this.permissionModeSyncCallback) {
      return;
    }

    try {
      this.permissionModeSyncCallback(permissionMode);
    } catch {
      // Non-critical UI sync callback.
    }
  }

  private refreshModelSelectors(): void {
    for (const view of this.plugin.getAllViews()) {
      view.refreshModelSelector();
    }
  }

  // ---------------------------------------------------------------------------
  // Vault system prompt
  // ---------------------------------------------------------------------------

  private getSystemPromptSettings(vaultPath: string): SystemPromptSettings {
    return {
      customPrompt: this.plugin.settings.systemPrompt,
      mediaFolder: this.plugin.settings.mediaFolder,
      userName: this.plugin.settings.userName,
      vaultPath,
      workspaceMode: normalizeWorkspaceMode(this.plugin.settings.workspaceMode),
    };
  }

  /**
   * Returns the vault preamble for this turn, or nothing when the current
   * session already carries an identical one. Marks it as sent immediately so a
   * second turn does not duplicate it; the prompt failure path rolls that back.
   */
  private consumeVaultPrompt(
    sessionId: string,
    cwd: string,
    promptText: string,
  ): { vaultPrompt: string } | null {
    if (!getHermesProviderSettings(this.getProviderSettings()).injectVaultPrompt) {
      return null;
    }

    // Hermes only intercepts a slash command when the prompt STARTS with `/`
    // (acp_adapter/server.py). Prepending the preamble would turn `/compress`
    // into ordinary text, so the injection waits for the next real turn.
    if (promptText.trimStart().startsWith('/')) {
      return null;
    }

    const promptSettings = this.getSystemPromptSettings(cwd);
    const promptKey = computeSystemPromptKey(promptSettings);
    if (this.vaultPromptSessionId === sessionId && this.vaultPromptKey === promptKey) {
      return null;
    }

    this.vaultPromptSessionId = sessionId;
    this.vaultPromptKey = promptKey;
    return { vaultPrompt: buildSystemPrompt(promptSettings) };
  }

  // ---------------------------------------------------------------------------
  // Notifications, permissions, filesystem
  // ---------------------------------------------------------------------------

  private async handleSessionNotification(notification: AcpSessionNotification): Promise<void> {
    if (notification.sessionId !== this.sessionId) {
      return;
    }

    this.lastNotificationAt = Date.now();
    const normalized = this.sessionUpdateNormalizer.normalize(notification.update);

    if (normalized.type === 'commands') {
      this.setSupportedCommands(normalized.commands);
      return;
    }

    if (normalized.type === 'current_mode') {
      await this.syncSessionModeState({ currentModeId: normalized.currentModeId });
      return;
    }

    if (!this.activeTurn || this.activeTurn.sessionId !== notification.sessionId) {
      return;
    }

    switch (normalized.type) {
      case 'message_chunk': {
        if (normalized.role !== 'user') {
          this.sawAssistantOutput = true;
        }
        if (normalized.role === 'assistant' && normalized.messageId) {
          this.currentTurnMetadata.assistantMessageId = normalized.messageId;
        }
        if (normalized.role === 'user' && normalized.messageId) {
          this.currentTurnMetadata.userMessageId = normalized.messageId;
        }
        for (const chunk of normalized.streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        this.sawAssistantOutput = true;
        const streamChunks = normalized.type === 'tool_call'
          ? this.toolStreamAdapter.normalizeToolCall(
            enrichHermesToolCall(normalized.toolCall),
            normalized.streamChunks,
          )
          : this.toolStreamAdapter.normalizeToolCallUpdate(
            normalized.toolCallUpdate,
            normalized.streamChunks,
          );
        for (const chunk of streamChunks) {
          this.activeTurn.queue.push(chunk);
        }
        return;
      }
      case 'usage': {
        this.contextUsage = normalized.usage;
        const usage = buildAcpUsageInfo({
          contextWindow: normalized.usage,
          model: this.getActiveDisplayModel(),
          promptUsage: this.promptUsage,
          reportType: 'snapshot',
        });
        if (usage) {
          this.activeTurn.queue.push({ sessionId: notification.sessionId, type: 'usage', usage });
        }
        return;
      }
      default:
        return;
    }
  }

  private async handlePermissionRequest(
    request: AcpRequestPermissionRequest,
  ): Promise<AcpRequestPermissionResponse> {
    if (!this.approvalCallback) {
      return { outcome: { outcome: 'cancelled' } };
    }

    const input = normalizeApprovalInput(request.toolCall.rawInput);
    const presentation = buildHermesPermissionPresentation(
      request.toolCall.title,
      request.toolCall.kind,
      input,
      request.toolCall.locations,
    );
    const decision = await this.approvalCallback(
      presentation.toolName,
      input,
      presentation.description,
      {
        ...(presentation.blockedPath ? { blockedPath: presentation.blockedPath } : {}),
        ...(presentation.decisionReason ? { decisionReason: presentation.decisionReason } : {}),
        decisionOptions: buildAcpApprovalDecisionOptions(request.options),
      },
    );

    return mapApprovalDecision(decision, request.options);
  }

  private setSupportedCommands(commands: SlashCommand[]): void {
    this.supportedCommands = commands.map((command) => ({ ...command }));

    const waiters = this.supportedCommandWaiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.supportedCommands);
    }
  }

  private waitForSupportedCommands(timeoutMs = 250): Promise<SlashCommand[]> {
    if (this.supportedCommands.length > 0) {
      return Promise.resolve([...this.supportedCommands]);
    }

    return new Promise<SlashCommand[]>((resolve) => {
      const waiter = (commands: SlashCommand[]) => {
        window.clearTimeout(timeoutId);
        resolve([...commands]);
      };
      const timeoutId = window.setTimeout(() => {
        const index = this.supportedCommandWaiters.indexOf(waiter);
        if (index >= 0) {
          this.supportedCommandWaiters.splice(index, 1);
        }
        resolve([...this.supportedCommands]);
      }, timeoutMs);

      this.supportedCommandWaiters.push(waiter);
    });
  }

  private async readTextFile(request: AcpReadTextFileRequest): Promise<{ content: string }> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    const content = await fs.readFile(resolvedPath, 'utf-8');

    if (request.line === undefined && request.limit === undefined) {
      return { content };
    }

    const lines = content.split(/\r?\n/);
    const startIndex = Math.max(0, (request.line ?? 1) - 1);
    const endIndex = request.limit ? startIndex + Math.max(0, request.limit) : lines.length;

    return { content: lines.slice(startIndex, endIndex).join('\n') };
  }

  private async writeTextFile(request: AcpWriteTextFileRequest): Promise<Record<string, never>> {
    const resolvedPath = this.resolveSessionPath(request.sessionId, request.path);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, request.content, 'utf-8');
    return {};
  }

  private resolveSessionPath(sessionId: string, rawPath: string): string {
    if (path.isAbsolute(rawPath)) {
      return rawPath;
    }

    const cwd = this.sessionCwds.get(sessionId)
      ?? getVaultPath(this.plugin.app)
      ?? process.cwd();
    return path.resolve(cwd, rawPath);
  }

  private formatRuntimeError(error: unknown): string {
    const baseMessage = error instanceof Error ? error.message : 'Hermes-Anfrage fehlgeschlagen';
    const stderr = this.process?.getStderrSnapshot();
    return stderr ? `${baseMessage}\n\n${stderr}` : baseMessage;
  }
}

/**
 * Turns a non-productive ACP stop reason into a user-facing error. Reasons that
 * simply end a normal turn (`end_turn`, `cancelled`) return null, as does any
 * reason that arrived after the model had already produced output.
 */
function describeUnproductiveStopReason(
  stopReason: string | undefined,
  sawAssistantOutput: boolean,
): string | null {
  switch (stopReason) {
    case 'refusal':
      return sawAssistantOutput
        ? null
        : 'Hermes hat den Turn abgelehnt. Die Sitzung ist dem Agenten nicht mehr bekannt — die nächste Nachricht startet eine neue Sitzung.';
    case 'max_tokens':
      return sawAssistantOutput
        ? null
        : 'Hermes hat das Token-Limit der Antwort erreicht, bevor Text erzeugt wurde.';
    case 'max_turn_requests':
      return 'Hermes hat das Limit an Tool-Durchläufen für diesen Turn erreicht.';
    default:
      return null;
  }
}

function normalizeApprovalInput(rawInput: unknown): Record<string, unknown> {
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    return rawInput as Record<string, unknown>;
  }
  if (rawInput === undefined) {
    return {};
  }
  return { value: rawInput };
}

/**
 * Hermes only asks for approval on dangerous terminal commands and on edits
 * outside the current policy, so the presentation is keyed off the ACP tool
 * kind with the title as the human-readable detail.
 */
function buildHermesPermissionPresentation(
  rawTitle: string | null | undefined,
  kind: string | null | undefined,
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): {
  blockedPath?: string;
  decisionReason?: string;
  description: string;
  toolName: string;
} {
  const title = rawTitle?.trim() || 'Tool';
  const blockedPath = extractPermissionPath(input, locations);

  if (kind === 'execute') {
    return {
      decisionReason: 'Hermes fragt vor einem Shell-Befehl nach',
      description: title,
      toolName: 'bash',
    };
  }

  if (kind === 'edit' || kind === 'delete' || kind === 'move') {
    return {
      ...(blockedPath ? { blockedPath } : {}),
      decisionReason: 'Hermes möchte Dateien ändern',
      description: title,
      toolName: 'edit',
    };
  }

  if (kind === 'read') {
    return {
      ...(blockedPath ? { blockedPath } : {}),
      description: title,
      toolName: 'read',
    };
  }

  return {
    ...(blockedPath ? { blockedPath } : {}),
    description: title,
    toolName: title,
  };
}

function extractPermissionPath(
  input: Record<string, unknown>,
  locations: Array<{ path: string }> | null | undefined,
): string | undefined {
  for (const key of ['path', 'file_path', 'filePath', 'target']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return locations?.find((location) => location.path.trim())?.path.trim() || undefined;
}

function mapApprovalDecision(
  decision: ApprovalDecision,
  options: readonly AcpPermissionOption[],
): AcpRequestPermissionResponse {
  if (decision === 'allow') {
    return selectPermissionOption(options, ['allow_once', 'allow_always']);
  }
  if (decision === 'allow-always') {
    return selectPermissionOption(options, ['allow_always', 'allow_once']);
  }
  if (decision === 'deny') {
    return selectPermissionOption(options, ['reject_once', 'reject_always']);
  }
  if (typeof decision === 'object' && decision.type === 'select-option') {
    return { outcome: { optionId: decision.value, outcome: 'selected' } };
  }

  return { outcome: { outcome: 'cancelled' } };
}

function buildAcpApprovalDecisionOptions(
  options: readonly AcpPermissionOption[],
): ApprovalDecisionOption[] {
  return options.map((option) => ({
    ...(option.kind === 'allow_once'
      ? { decision: 'allow' as const }
      : option.kind === 'allow_always'
      ? { decision: 'allow-always' as const }
      : {}),
    label: option.name,
    value: option.optionId,
  }));
}

function selectPermissionOption(
  options: readonly AcpPermissionOption[],
  preferredKinds: readonly AcpPermissionOption['kind'][],
): AcpRequestPermissionResponse {
  for (const kind of preferredKinds) {
    const option = options.find((entry) => entry.kind === kind);
    if (option) {
      return { outcome: { optionId: option.optionId, outcome: 'selected' } };
    }
  }

  return { outcome: { outcome: 'cancelled' } };
}
