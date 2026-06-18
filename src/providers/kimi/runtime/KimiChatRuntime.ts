import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as path from 'node:path';

import { Notice } from 'obsidian';

import { expandProviderCommandInput } from '../../../core/providers/commands/expandProviderCommandInput';
import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import { ProviderWorkspaceRegistry } from '../../../core/providers/ProviderWorkspaceRegistry';
import type { ProviderCapabilities } from '../../../core/providers/types';
import { buildEstimatedUsageInfo, estimateTokensForTexts } from '../../../core/providers/usage/estimateUsage';
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
import type { TodoItem } from '../../../core/tools/todo';
import { TOOL_TODO_WRITE } from '../../../core/tools/toolNames';
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
  resolveWindowsCmdShimSpawnSpec,
  terminateSpawnedProcess,
  type WindowsCmdShimSpawnSpec,
} from '../../../utils/windowsCmdShim';
import { KIMI_PROVIDER_CAPABILITIES } from '../capabilities';
import { KimiHelpModal } from '../commands/KimiHelpModal';
import { KimiSessionListModal } from '../commands/KimiSessionListModal';
import { KimiSlashCommandHandler } from '../commands/KimiSlashCommandHandler';
import { getKimiModelContextWindow, resolveKimiModelSelection } from '../modelOptions';
import { parseKimiStreamLine } from '../normalization/streamEvents';
import {
  createKimiStreamState,
  type KimiStreamState,
  mapKimiEventToChunks,
} from '../normalization/streamMapping';
import { getKimiProviderSettings, KIMI_PROVIDER_ID } from '../settings';
import { buildPersistedKimiState, getKimiState, type KimiProviderState } from '../types';
import { prepareKimiPromptWithGoal } from './KimiGoalPrompt';
import { buildKimiLaunchSpec, detectKimiCliFlavor } from './KimiLaunchSpec';
import { buildKimiRuntimeEnv } from './KimiRuntimeEnvironment';

// stderr prints a resume hint after each run, e.g. `kimi -r <session-id>`.
const SESSION_HINT_PATTERN = /kimi(?:-cli)?\s+-r\s+([^\s]+)/i;
const SESSION_HINT_PATTERN_ALT = /resume this session:\s*kimi(?:-cli)?\s+-r\s+([^\s]+)/i;

/**
 * Single-turn subprocess runtime for the Kimi (`kimi-cli`) CLI.
 *
 * Each turn spawns `kimi-cli --print --output-format stream-json …` and parses
 * the stdout JSON lines LIVE (one complete chat message per line) into
 * `StreamChunk`s. Conversation continuity uses native resume: the session id is
 * recovered from the stderr resume hint after the first run and replayed via
 * `--session <id>`. Unlike antigravity there is no transcript-file tail.
 */
export class KimiChatRuntime implements ChatRuntime {
  readonly providerId = KIMI_PROVIDER_ID;

  private sessionId: string | null = null;
  private goal: string | null = null;
  private forkParentId: string | null = null;
  private sessionInvalidated = false;
  private ready = false;
  private currentTurnMetadata: ChatTurnMetadata = {};
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private activeProcess: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;
  private currentTodos: TodoItem[] = [];
  private askUserQuestionCallback: AskUserQuestionCallback | null = null;
  private slashHandler: KimiSlashCommandHandler;

  constructor(private readonly plugin: ClaudianPlugin) {
    this.slashHandler = new KimiSlashCommandHandler(
      () => ({ sessionId: this.sessionId ?? undefined, goal: this.goal ?? undefined }),
      (state) => {
        this.sessionId = state.sessionId ?? null;
        this.goal = state.goal ?? null;
        this.forkParentId = state.forkParentId ?? null;
        this.sessionInvalidated = false;
      },
      {
        openSessionList: () => {
          new KimiSessionListModal(
            this.plugin.app,
            (id) => {
              this.sessionId = id;
              this.sessionInvalidated = false;
              new Notice(`Resumed Kimi session ${id}`);
            },
            this.goal ?? undefined,
          ).open();
        },
        openHelp: () => new KimiHelpModal(this.plugin.app, this.goal ?? undefined).open(),
        closeTab: () => {
          const view = this.plugin.getView();
          const tabManager = view?.getTabManager();
          const activeTabId = tabManager?.getActiveTabId();
          if (tabManager && activeTabId) {
            void tabManager.closeTab(activeTabId);
          }
        },
      },
    );
  }

  getCapabilities(): Readonly<ProviderCapabilities> {
    return KIMI_PROVIDER_CAPABILITIES;
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
      this.goal = null;
      this.sessionInvalidated = false;
      return;
    }
    const state = getKimiState(conversation.providerState);
    // Only resume Kimi's OWN session (from providerState). Never fall back to
    // the shared conversation.sessionId — after switching providers mid-chat it
    // holds another provider's id, which kimi-cli would reject. No own session
    // → start fresh.
    this.sessionId = state.sessionId ?? null;
    this.goal = state.goal ?? null;
    this.forkParentId = state.forkParentId ?? null;
    this.sessionInvalidated = false;
  }

  async reloadMcpServers(): Promise<void> {}

  async ensureReady(_options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
    const settings = getKimiProviderSettings(
      this.plugin.settings as unknown as Record<string, unknown>,
    );
    if (!settings.enabled) {
      this.setReady(false);
      return false;
    }
    const resolved = this.plugin.getResolvedProviderCliPath(KIMI_PROVIDER_ID);
    this.setReady(Boolean(resolved));
    return Boolean(resolved);
  }

  private async *runAuthCommand(
    action: 'login' | 'logout',
    command: string,
    env: NodeJS.ProcessEnv,
    cwd: string,
  ): AsyncGenerator<StreamChunk> {
    if (detectKimiCliFlavor(command) === 'legacy') {
      yield {
        type: 'error',
        content: `/${action} requires the modern \`kimi\` binary. The legacy \`kimi-cli\` does not support authentication commands.`,
      };
      yield { type: 'done' };
      return;
    }

    yield { type: 'user_message_start', content: `/${action}` };
    yield { type: 'text', content: `Running \`kimi ${action}\`...` };

    let proc: ChildProcessWithoutNullStreams;
    let resolvedSpawnSpec: WindowsCmdShimSpawnSpec;
    try {
      resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec({
        command,
        args: [action],
      });
      proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
        cwd,
        env: {
          ...env,
          PATH: getEnhancedPath(env.PATH, path.isAbsolute(command) ? command : undefined),
        },
        stdio: 'pipe',
        windowsHide: true,
        ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : `Failed to run \`kimi ${action}\`.`,
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.on('error', (error) => {
        stderr += error instanceof Error ? error.message : String(error);
        resolve(null);
      });
      proc.on('close', (code) => resolve(code));
    });

    this.activeProcess = null;

    const output = stdout.trim() || stderr.trim();
    if (output) {
      yield { type: 'text', content: output };
    }

    if (exitCode !== 0) {
      yield {
        type: 'error',
        content: `\`kimi ${action}\` exited with code ${exitCode ?? 'unknown'}.${stderr ? `\n\n${stderr.trim()}` : ''}`,
      };
    }

    yield { type: 'done' };
  }

  async *query(
    turn: PreparedChatTurn,
    conversationHistory?: ChatMessage[],
    queryOptions?: ChatRuntimeQueryOptions,
  ): AsyncGenerator<StreamChunk> {
    this.currentTurnMetadata = {};
    this.cancelled = false;
    this.currentTodos = [];

    const settingsBag = this.plugin.settings as unknown as Record<string, unknown>;
    const settings = getKimiProviderSettings(settingsBag);
    if (!settings.enabled) {
      yield { type: 'error', content: 'Kimi is disabled. Enable it in settings.' };
      yield { type: 'done' };
      return;
    }

    const command = this.plugin.getResolvedProviderCliPath(KIMI_PROVIDER_ID);
    if (!command) {
      yield {
        type: 'error',
        content: 'Could not find the `kimi-cli` binary. Set the CLI path in Kimi settings.',
      };
      yield { type: 'done' };
      return;
    }

    const cwd = getVaultPath(this.plugin.app) ?? process.cwd();
    const env = buildKimiRuntimeEnv(settingsBag, command);
    const envText = getRuntimeEnvironmentText(settingsBag, KIMI_PROVIDER_ID);
    const model = queryOptions?.model?.trim()
      || resolveKimiModelSelection(settingsBag, typeof settingsBag.model === 'string' ? settingsBag.model : '')
      || '';

    // Expand a chosen vault command/skill client-side — kimi-cli print mode
    // can't expand `/command` or `$skill` tokens itself. Unknown input and
    // ordinary prompts pass through unchanged. Best-effort: any catalog error
    // falls back to the raw text.
    let promptText = turn.request.text;
    try {
      const catalog = ProviderWorkspaceRegistry.getCommandCatalog(KIMI_PROVIDER_ID);
      if (catalog) {
        const entries = await catalog.listDropdownEntries({ includeBuiltIns: false });
        promptText = expandProviderCommandInput(turn.request.text, entries);
      }
    } catch {
      promptText = turn.request.text;
    }

    // Mirror "/goal" locally so the standing objective survives across turns in
    // print mode. The raw `/goal` command is still sent to Kimi for confirmation.
    const goalResult = prepareKimiPromptWithGoal(promptText, this.goal);
    this.goal = goalResult.nextGoal;
    promptText = goalResult.promptToSend;

    // Handle Kimi-native slash commands that should trigger UI actions rather
    // than being sent to the CLI (e.g. /new, /fork, /sessions, /help, /exit).
    const slashResult = await this.slashHandler.execute(promptText);
    if (slashResult.consumed) {
      if (slashResult.authAction) {
        yield* this.runAuthCommand(slashResult.authAction, command, env, cwd);
        return;
      }
      if (slashResult.followUpPrompt) {
        yield { type: 'text', content: slashResult.followUpPrompt };
      }
      yield { type: 'done' };
      return;
    }

    const launchSpec = buildKimiLaunchSpec({
      agent: settings.agent,
      agentFile: settings.agentFile,
      command,
      cwd,
      env,
      envText,
      mcpConfigFile: settings.mcpConfigFile,
      model,
      permissionMode: settings.permissionMode,
      prompt: promptText,
      // Never `--continue` on a fresh chat: that resumes the most recent
      // kimi-cli session for this cwd (e.g. an unrelated terminal session or a
      // prior chat) and bleeds its context in. Resume only via an explicit
      // `--session <id>` once this conversation already owns one.
      sessionId: this.sessionId,
      thinking: settings.thinkingDefault,
    });

    yield { type: 'user_message_start', content: turn.request.text };

    let proc: ChildProcessWithoutNullStreams;
    let resolvedSpawnSpec: WindowsCmdShimSpawnSpec;
    try {
      resolvedSpawnSpec = resolveWindowsCmdShimSpawnSpec(launchSpec);
      proc = spawn(resolvedSpawnSpec.command, resolvedSpawnSpec.args, {
        cwd,
        env: {
          ...env,
          PATH: getEnhancedPath(env.PATH, path.isAbsolute(command) ? command : undefined),
        },
        stdio: 'pipe',
        windowsHide: true,
        ...(resolvedSpawnSpec.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
      });
    } catch (error) {
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : 'Failed to launch kimi-cli.',
      };
      yield { type: 'done' };
      return;
    }

    this.activeProcess = proc;
    // Close stdin so a non-TTY child process can't block on the open pipe;
    // `kimi-cli` print mode never reads stdin.
    proc.stdin.end();
    const streamState = createKimiStreamState();
    let stdoutBuffer = '';
    let stderr = '';
    const unparsedStdoutLines: string[] = [];
    const pendingChunks: StreamChunk[] = [];
    let toolResultIndex = 0;

    // Live pump: stdout 'data' events parse complete JSON lines into chunks and
    // wake the generator loop below, which yields each chunk to the chat UI the
    // moment it arrives. Previously all chunks were buffered and only yielded
    // after the process exited, so kimi output appeared all at once at the end.
    let finished = false;
    let exitInfo: { code: number | null; error?: Error } = { code: null };
    let wake: (() => void) | null = null;
    const signal = (): void => {
      if (wake) {
        const resume = wake;
        wake = null;
        resume();
      }
    };

    const drainCompleteLines = (): void => {
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!this.consumeLine(line, streamState, pendingChunks, () => toolResultIndex++)) {
          const trimmed = line.trim();
          if (trimmed) {
            unparsedStdoutLines.push(trimmed);
          }
        }
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
      signal();
    };

    proc.stdout.on('data', (chunk: Buffer | string) => {
      stdoutBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      drainCompleteLines();
    });
    proc.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    });

    const onExit = (info: { code: number | null; error?: Error }): void => {
      // Flush any trailing partial line that arrived without a newline.
      if (stdoutBuffer.trim()) {
        if (!this.consumeLine(stdoutBuffer, streamState, pendingChunks, () => toolResultIndex++)) {
          unparsedStdoutLines.push(stdoutBuffer.trim());
        }
        stdoutBuffer = '';
      }
      exitInfo = info;
      finished = true;
      signal();
    };
    proc.on('error', (error) => onExit({ code: null, error }));
    proc.on('close', (code) => onExit({ code }));

    let responseText = '';
    try {
      // Drain all available chunks, then sleep until the next 'data'/'close'
      // wakes us. The single-threaded model guarantees no lost wakeup: chunks
      // are always fully drained before we install `wake`, and `close` always
      // fires eventually to release a final wait.
      while (true) {
        while (pendingChunks.length > 0) {
          const chunk = pendingChunks.shift() as StreamChunk;
          if ((chunk.type === 'text' || chunk.type === 'thinking') && typeof chunk.content === 'string') {
            responseText += chunk.content;
          }
          const todoChunk = this.trackToolCallAsTodo(chunk);
          if (todoChunk) {
            yield todoChunk;
          }
          yield chunk;
        }
        if (finished) {
          break;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }

      this.recoverSessionId(stderr);

      if (exitInfo.error) {
        yield {
          type: 'error',
          content: this.formatError(exitInfo.error.message, stderr, unparsedStdoutLines),
        };
        yield { type: 'done' };
        return;
      }

      if (exitInfo.code !== 0 && exitInfo.code !== null) {
        yield {
          type: 'error',
          content: this.formatError(`Kimi CLI exited with code ${exitInfo.code}`, stderr, unparsedStdoutLines),
        };
        yield { type: 'done' };
        return;
      }

      this.currentTurnMetadata.wasSent = true;
      // Estimated context-window feedback: kimi-cli reports no token usage, so
      // approximate from the conversation history + this turn's prompt/response.
      const contextTokens = estimateTokensForTexts([
        ...(conversationHistory ?? []).map((message) => message.content ?? ''),
        promptText,
        responseText,
      ]);
      yield {
        type: 'usage',
        usage: buildEstimatedUsageInfo({
          contextTokens,
          contextWindow: getKimiModelContextWindow(model),
          model: model || undefined,
        }),
        sessionId: this.sessionId,
      };
      yield { type: 'done' };
    } finally {
      if (this.activeProcess === proc) {
        this.activeProcess = null;
      }
    }
  }

  /**
   * Tracks live tool calls as a task list so Kimi shows a Codex-style todo
   * panel. Each tool_use adds/updates a task; the matching tool_result marks
   * it completed. The panel is updated via synthetic TodoWrite tool events.
   */
  private trackToolCallAsTodo(chunk: StreamChunk): StreamChunk | null {
    if (chunk.type === 'tool_use' && chunk.name !== TOOL_TODO_WRITE) {
      const description = describeToolUse(chunk.name, chunk.input);
      const existingIndex = this.currentTodos.findIndex((todo) => todo.content === description.content);
      if (existingIndex >= 0) {
        this.currentTodos[existingIndex] = {
          ...this.currentTodos[existingIndex],
          status: 'in_progress',
          activeForm: description.activeForm,
        };
      } else {
        this.currentTodos.push({ ...description, status: 'in_progress' });
      }
      return this.buildTodoWriteChunk();
    }

    if (chunk.type === 'tool_result') {
      const description = describeToolResult(chunk.id, chunk.content, this.currentTodos);
      const matching = this.currentTodos.findIndex((todo) =>
        todo.status === 'in_progress' && todo.content === description.content
      );
      if (matching >= 0) {
        this.currentTodos[matching] = { ...this.currentTodos[matching], status: 'completed' };
        return this.buildTodoWriteChunk();
      }
    }

    return null;
  }

  private buildTodoWriteChunk(): StreamChunk {
    return {
      type: 'tool_use',
      id: `kimi-todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: TOOL_TODO_WRITE,
      input: { todos: [...this.currentTodos], __panelOnly: true },
    };
  }

  cancel(): void {
    this.cancelled = true;
    const proc = this.activeProcess;
    if (proc && proc.exitCode === null) {
      terminateSpawnedProcess(proc, 'SIGTERM', spawn, null);
    }
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
  setAskUserQuestionCallback(callback: AskUserQuestionCallback | null): void {
    this.askUserQuestionCallback = callback;
  }
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
    const state: KimiProviderState = {
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
      ...(this.goal ? { goal: this.goal } : {}),
      ...(this.forkParentId ? { forkParentId: this.forkParentId } : {}),
    };
    return {
      updates: {
        providerState: buildPersistedKimiState(state),
        sessionId: this.sessionId,
      },
    };
  }

  resolveSessionIdForFork(conversation: Conversation | null): string | null {
    return (
      this.sessionId
      ?? getKimiState(conversation?.providerState).sessionId
      ?? null
    );
  }

  async loadSubagentToolCalls(_agentId: string): Promise<ToolCallInfo[]> {
    return [];
  }

  async loadSubagentFinalResult(_agentId: string): Promise<string | null> {
    return null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private consumeLine(
    line: string,
    streamState: KimiStreamState,
    sink: StreamChunk[],
    nextIndex: () => number,
  ): boolean {
    const event = parseKimiStreamLine(line);
    if (!event) {
      return false;
    }
    const sessionFromEvent = event.raw.session_id;
    if (typeof sessionFromEvent === 'string' && sessionFromEvent.trim()) {
      this.sessionId = sessionFromEvent.trim();
    }
    const chunks = mapKimiEventToChunks(event, streamState, event.role === 'tool' ? nextIndex() : 0);
    for (const chunk of chunks) {
      sink.push(chunk);
    }
    return true;
  }

  private recoverSessionId(stderr: string): void {
    if (this.sessionId) {
      return;
    }
    const match = stderr.match(SESSION_HINT_PATTERN_ALT) ?? stderr.match(SESSION_HINT_PATTERN);
    if (match && match[1]) {
      this.sessionId = match[1].trim();
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

  private formatError(message: string, stderr: string, stdoutLines: string[] = []): string {
    const trimmed = stderr.trim().slice(-2000);
    const stdout = stdoutLines.join('\n').trim().slice(-2000);
    const details = [stdout, trimmed].filter(Boolean).join('\n\n');
    return details ? `${message}\n\n${details}` : message;
  }
}

const TOOL_NAME_DESCRIPTIONS: Record<string, { content: string; activeForm: string }> = {
  bash: { content: 'Run command', activeForm: 'Running command' },
  read_file: { content: 'Read file', activeForm: 'Reading file' },
  write_file: { content: 'Write file', activeForm: 'Writing file' },
  edit_file: { content: 'Edit file', activeForm: 'Editing file' },
  search: { content: 'Search files', activeForm: 'Searching files' },
  glob: { content: 'List files', activeForm: 'Listing files' },
  ls: { content: 'List directory', activeForm: 'Listing directory' },
  cat: { content: 'Show file', activeForm: 'Showing file' },
  grep: { content: 'Search content', activeForm: 'Searching content' },
  web_search: { content: 'Search web', activeForm: 'Searching web' },
  url_fetch: { content: 'Fetch URL', activeForm: 'Fetching URL' },
  // Kimi Code uses PascalCase tool names (Read, Write, Edit, Bash, …).
  read: { content: 'Read file', activeForm: 'Reading file' },
  view: { content: 'View file', activeForm: 'Viewing file' },
  write: { content: 'Write file', activeForm: 'Writing file' },
  edit: { content: 'Edit file', activeForm: 'Editing file' },
  multiedit: { content: 'Edit files', activeForm: 'Editing files' },
};

function describeToolUse(
  name: string,
  input: Record<string, unknown>,
): { content: string; activeForm: string } {
  const normalized = name.toLowerCase().trim();
  const base = TOOL_NAME_DESCRIPTIONS[normalized] ?? {
    content: humanizeToolName(normalized),
    activeForm: humanizeToolName(normalized),
  };

  const target = extractToolTarget(input);
  if (!target) {
    return base;
  }

  const shortTarget = target.split('/').pop() ?? target;
  return {
    content: `${base.content}: ${shortTarget}`,
    activeForm: `${base.activeForm}: ${shortTarget}`,
  };
}

function describeToolResult(
  toolId: string,
  _content: string,
  currentTodos: TodoItem[],
): { content: string; activeForm: string } {
  // Prefer matching the exact in-progress task by its synthetic tool id if we
  // stored it; otherwise fall back to a generic label.
  const matching = currentTodos.find((todo) => todo.status === 'in_progress');
  if (matching) {
    return { content: matching.content, activeForm: matching.activeForm };
  }
  return { content: 'Run tool', activeForm: 'Running tool' };
}

function extractToolTarget(input: Record<string, unknown>): string | null {
  const candidates = [
    input.file_path,
    input.path,
    input.file,
    input.directory,
    input.dir,
    input.command,
    input.query,
    input.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function humanizeToolName(name: string): string {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
