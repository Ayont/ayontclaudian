import { TOOL_TODO_WRITE } from '../../../core/tools/toolNames';
import type { StreamChunk, SubagentLiveUpdate } from '../../../core/types';
import {
  readCodexThreadIds,
  readReadableCodexText,
  toCodexTaskLabel,
} from '../normalization/codexCollabNormalization';
import { codexSubagentLifecycleAdapter } from '../normalization/codexSubagentNormalization';
import { type CodexChildThreadSummary, CodexNotificationRouter } from './CodexNotificationRouter';

type ChunkEmitter = (chunk: StreamChunk) => void;

export interface CodexChildTurnTarget {
  threadId: string;
  turnId: string;
}

export interface CodexChildThreadRelayOptions {
  maxBufferedPerThread?: number;
}

interface ChildProfile {
  nickname?: string;
  role?: string;
  taskLabel?: string;
  /** The child thread's own configured model; beats the one the spawn requested. */
  threadModel?: string;
  requestedModel?: string;
  prompt?: string;
}

interface PendingNotification {
  method: string;
  params: unknown;
}

interface ChildThread {
  readonly threadId: string;
  /** thread/started named our parent, or one of the parent's spawns named this thread. */
  confirmed: boolean;
  /** The parent's spawn tool call id; the chat keys the subagent card by it. */
  subagentId: string | null;
  router: CodexNotificationRouter | null;
  pending: PendingNotification[];
  activeTurnId: string | null;
  profile: ChildProfile;
  lastUpdateKey: string;
  latestMessage: string;
  lastChunkWasText: boolean;
  separatorPending: boolean;
  droppedToolIds: Set<string>;
  cancelRequested: boolean;
}

const DEFAULT_MAX_BUFFERED_PER_THREAD = 200;
// Threads we have not yet been able to attribute; bounded because nothing
// guarantees a spawn will ever name them.
const MAX_UNCONFIRMED_THREADS = 8;

/**
 * Relays the activity of subagent threads spawned by the current parent
 * thread into the parent stream as `subagent_*` chunks.
 *
 * Each child gets its own notification router so its item bookkeeping never
 * mixes with the parent's; everything but tool calls and text is dropped, so a
 * child can neither end the parent's turn nor move its context meter. The
 * relay deliberately outlives single parent turns (background agents keep
 * running) and only forgets its children when the parent thread changes or
 * the app-server restarts.
 */
export class CodexChildThreadRelay {
  private parentThreadId: string | null = null;
  private children = new Map<string, ChildThread>();
  private threadIdsBySubagent = new Map<string, string>();
  private foreignThreadIds = new Set<string>();
  private readonly maxBufferedPerThread: number;

  constructor(
    private readonly emit: ChunkEmitter,
    options: CodexChildThreadRelayOptions = {},
  ) {
    this.maxBufferedPerThread = Math.max(1, options.maxBufferedPerThread ?? DEFAULT_MAX_BUFFERED_PER_THREAD);
  }

  getParentThreadId(): string | null {
    return this.parentThreadId;
  }

  setParentThread(threadId: string | null): void {
    if (threadId === this.parentThreadId) return;
    this.reset();
    this.parentThreadId = threadId;
  }

  /** Forgets every child thread; the parent thread stays. */
  reset(): void {
    this.children.clear();
    this.threadIdsBySubagent.clear();
    this.foreignThreadIds.clear();
  }

  /**
   * Claims notifications that belong to a child thread. Returns false for the
   * parent's own traffic and for threads that belong to someone else, so the
   * caller's routing stays unchanged for them.
   */
  consumeNotification(method: string, params: unknown): boolean {
    if (!this.parentThreadId) return false;
    if (method === 'thread/started') return this.onThreadStarted(params);

    const threadId = readString(asRecord(params)?.threadId);
    if (!threadId || threadId === this.parentThreadId || this.foreignThreadIds.has(threadId)) {
      return false;
    }

    const child = this.children.get(threadId) ?? this.trackUnconfirmedThread(threadId);
    this.trackTurn(child, method, params);
    if (child.router) {
      this.forward(child, method, params);
    } else {
      this.buffer(child, { method, params });
    }
    return true;
  }

  /** Learns child → spawn links from the parent's own items; never consumes them. */
  observeParentNotification(method: string, params: unknown): void {
    if (method !== 'item/started' && method !== 'item/completed') return;
    const notification = asRecord(params);
    if (!this.parentThreadId || notification?.threadId !== this.parentThreadId) return;

    const item = asRecord(notification.item);
    const itemId = readString(item?.id);
    if (!item || !itemId) return;

    if (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent') {
      const childThreadId = readCodexThreadIds(item.receiverThreadIds)[0];
      if (childThreadId) {
        this.link(childThreadId, itemId, {
          requestedModel: readString(item.model),
          prompt: readReadableCodexText(item.prompt) || undefined,
        });
      }
      return;
    }

    if (item.type === 'subAgentActivity' && item.kind === 'started') {
      const childThreadId = readString(item.agentThreadId);
      if (childThreadId) {
        this.link(childThreadId, itemId, { taskLabel: toCodexTaskLabel(item.agentPath) || undefined });
      }
    }
  }

  /** The child turn to interrupt for this subagent, or null when it is not running. */
  interruptTarget(subagentId: string, agentId?: string): CodexChildTurnTarget | null {
    const threadId = this.threadIdsBySubagent.get(subagentId)
      ?? (agentId && this.children.get(agentId)?.confirmed ? agentId : undefined);
    const child = threadId ? this.children.get(threadId) : undefined;
    return child?.activeTurnId ? { threadId: child.threadId, turnId: child.activeTurnId } : null;
  }

  /** The next interrupted turn of this child is then reported as a confirmed stop. */
  markCancelRequested(threadId: string): void {
    const child = this.children.get(threadId);
    if (child) child.cancelRequested = true;
  }

  clearCancelRequested(threadId: string): void {
    const child = this.children.get(threadId);
    if (child) child.cancelRequested = false;
  }

  describeChild(threadId: string): CodexChildThreadSummary | undefined {
    const child = this.children.get(threadId);
    if (!child?.confirmed) return undefined;

    const finalText = child.latestMessage.trim();
    return {
      ...(child.subagentId ? { subagentId: child.subagentId } : {}),
      ...(finalText ? { finalText } : {}),
    };
  }

  private onThreadStarted(params: unknown): boolean {
    const thread = asRecord(asRecord(params)?.thread);
    const threadId = readString(thread?.id);
    if (!thread || !threadId || threadId === this.parentThreadId) return false;

    const spawn = readThreadSpawnSource(thread.source);
    const claimedParent = readString(thread.parentThreadId) ?? spawn?.parentThreadId;
    const known = this.children.get(threadId);

    if (claimedParent && claimedParent !== this.parentThreadId) {
      // A spawn item from our parent outranks a conflicting claim.
      if (known?.subagentId) return true;
      this.children.delete(threadId);
      this.foreignThreadIds.add(threadId);
      return false;
    }
    if (!claimedParent && !known) return false;

    const child = known ?? this.createChild(threadId);
    child.confirmed = true;
    this.mergeProfile(child, {
      nickname: readString(thread.agentNickname) ?? spawn?.nickname,
      role: readString(thread.agentRole) ?? spawn?.role,
      taskLabel: toCodexTaskLabel(spawn?.agentPath) || undefined,
      threadModel: readString(thread.model),
    });
    return true;
  }

  private link(threadId: string, subagentId: string, profile: ChildProfile): void {
    this.foreignThreadIds.delete(threadId);
    const child = this.children.get(threadId) ?? this.createChild(threadId);
    child.confirmed = true;
    if (!child.subagentId) {
      child.subagentId = subagentId;
      this.threadIdsBySubagent.set(subagentId, threadId);
    }

    this.mergeProfile(child, profile);

    if (!child.router) {
      child.router = new CodexNotificationRouter((chunk) => this.relayChunk(child, chunk));
      const pending = child.pending;
      child.pending = [];
      for (const notification of pending) {
        this.forward(child, notification.method, notification.params);
      }
    }
  }

  private mergeProfile(child: ChildThread, patch: ChildProfile): void {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as ChildProfile;
    child.profile = { ...child.profile, ...defined };
    this.emitProfileUpdate(child);
  }

  private emitProfileUpdate(child: ChildThread): void {
    if (!child.subagentId) return;

    const update = buildProfileUpdate(child.profile);
    const key = JSON.stringify(update);
    if (key === '{}' || key === child.lastUpdateKey) return;

    child.lastUpdateKey = key;
    this.emit({ type: 'subagent_update', subagentId: child.subagentId, update });
  }

  private trackTurn(child: ChildThread, method: string, params: unknown): void {
    if (method !== 'turn/started' && method !== 'turn/completed') return;

    const turn = asRecord(asRecord(params)?.turn);
    const turnId = readString(turn?.id);
    if (!turnId) return;

    if (method === 'turn/started') {
      child.activeTurnId = turnId;
      return;
    }

    if (child.activeTurnId === turnId) {
      child.activeTurnId = null;
    }
    const wasCancelRequested = child.cancelRequested;
    child.cancelRequested = false;
    if (wasCancelRequested && turn?.status === 'interrupted' && child.subagentId) {
      this.emit({ type: 'subagent_update', subagentId: child.subagentId, update: { cancelled: true } });
    }
  }

  private forward(child: ChildThread, method: string, params: unknown): void {
    child.router?.handleNotification(method, params);
    if (method === 'turn/completed') {
      child.router?.endTurn();
    }
  }

  private buffer(child: ChildThread, notification: PendingNotification): void {
    child.pending.push(notification);
    if (child.pending.length > this.maxBufferedPerThread) {
      child.pending.shift();
    }
  }

  private relayChunk(child: ChildThread, chunk: StreamChunk): void {
    const subagentId = child.subagentId;
    if (!subagentId) return;

    switch (chunk.type) {
      case 'assistant_message_start':
        child.latestMessage = '';
        child.separatorPending = child.lastChunkWasText;
        return;

      case 'text': {
        if (!chunk.content) return;
        // The consumer appends; keep separate child messages from running together.
        const text = child.separatorPending ? `\n\n${chunk.content}` : chunk.content;
        child.separatorPending = false;
        child.lastChunkWasText = true;
        child.latestMessage += chunk.content;
        this.emit({ type: 'subagent_text', subagentId, text });
        return;
      }

      case 'tool_use':
        if (isDroppedChildTool(chunk.name)) {
          child.droppedToolIds.add(chunk.id);
          return;
        }
        child.lastChunkWasText = false;
        child.separatorPending = false;
        this.emit({ type: 'subagent_tool_use', subagentId, id: chunk.id, name: chunk.name, input: chunk.input });
        return;

      case 'tool_result':
        if (child.droppedToolIds.delete(chunk.id)) return;
        this.emit({
          type: 'subagent_tool_result',
          subagentId,
          id: chunk.id,
          content: chunk.content,
          ...(chunk.isError !== undefined ? { isError: chunk.isError } : {}),
        });
        return;

      default:
        // Usage, done, thinking, notices and errors belong to the child alone.
        return;
    }
  }

  private trackUnconfirmedThread(threadId: string): ChildThread {
    const unconfirmed = [...this.children.values()].filter(child => !child.confirmed);
    if (unconfirmed.length >= MAX_UNCONFIRMED_THREADS) {
      this.children.delete(unconfirmed[0].threadId);
    }
    return this.createChild(threadId);
  }

  private createChild(threadId: string): ChildThread {
    const child: ChildThread = {
      threadId,
      confirmed: false,
      subagentId: null,
      router: null,
      pending: [],
      activeTurnId: null,
      profile: {},
      lastUpdateKey: '',
      latestMessage: '',
      lastChunkWasText: false,
      separatorPending: false,
      droppedToolIds: new Set(),
      cancelRequested: false,
    };
    this.children.set(threadId, child);
    return child;
  }
}

/** Plans and lifecycle bookkeeping are the child's own business, not its timeline. */
function isDroppedChildTool(name: string): boolean {
  return name === TOOL_TODO_WRITE || codexSubagentLifecycleAdapter.isHiddenTool(name);
}

function buildProfileUpdate(profile: ChildProfile): SubagentLiveUpdate {
  const agentType = profile.role ?? profile.taskLabel ?? profile.nickname;
  const model = profile.threadModel ?? profile.requestedModel;
  return {
    ...(agentType ? { agentType } : {}),
    ...(model ? { model } : {}),
    ...(profile.prompt ? { prompt: profile.prompt } : {}),
  };
}

interface ThreadSpawnInfo {
  parentThreadId?: string;
  nickname?: string;
  role?: string;
  agentPath?: string;
}

function readThreadSpawnSource(source: unknown): ThreadSpawnInfo | null {
  const record = asRecord(source);
  // The v2 schema spells the variant `subAgent`; rollout files spell it `subagent`.
  const subAgent = asRecord(record?.subAgent ?? record?.subagent);
  const spawn = asRecord(subAgent?.thread_spawn);
  if (!spawn) return null;

  return {
    parentThreadId: readString(spawn.parent_thread_id),
    nickname: readString(spawn.agent_nickname),
    role: readString(spawn.agent_role),
    agentPath: readString(spawn.agent_path),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
