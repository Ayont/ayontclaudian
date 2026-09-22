import type { StreamChunk } from '@/core/types';
import { CodexChildThreadRelay } from '@/providers/codex/runtime/CodexChildThreadRelay';

const PARENT = 'thread-parent';
const CHILD = 'thread-child';
const SPAWN_ID = 'call_spawn';

describe('CodexChildThreadRelay', () => {
  let chunks: StreamChunk[];
  let relay: CodexChildThreadRelay;

  beforeEach(() => {
    chunks = [];
    relay = new CodexChildThreadRelay((chunk) => chunks.push(chunk));
    relay.setParentThread(PARENT);
  });

  function parentSpawnCompleted(childId = CHILD, spawnId = SPAWN_ID, extra: Record<string, unknown> = {}): void {
    relay.observeParentNotification('item/completed', {
      threadId: PARENT,
      turnId: 'turn-parent',
      item: {
        type: 'collabAgentToolCall',
        id: spawnId,
        tool: 'spawnAgent',
        status: 'completed',
        senderThreadId: PARENT,
        receiverThreadIds: [childId],
        agentsStates: { [childId]: { status: 'pendingInit' } },
        ...extra,
      },
    });
  }

  function childThreadStarted(childId = CHILD, thread: Record<string, unknown> = {}): boolean {
    return relay.consumeNotification('thread/started', {
      thread: {
        id: childId,
        parentThreadId: PARENT,
        agentNickname: 'Laplace',
        agentRole: null,
        model: 'gpt-6-luna',
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: PARENT,
              depth: 1,
              agent_nickname: 'Laplace',
              agent_role: null,
              agent_path: '/root/shortcut_patterns',
            },
          },
        },
        ...thread,
      },
    });
  }

  function child(method: string, params: Record<string, unknown>, threadId = CHILD): boolean {
    return relay.consumeNotification(method, { threadId, ...params });
  }

  function commandItem(id: string, completed: boolean): Record<string, unknown> {
    return {
      type: 'commandExecution',
      id,
      command: 'ls',
      cwd: '/vault',
      processId: '1',
      source: 'agent',
      status: completed ? 'completed' : 'inProgress',
      commandActions: [{ type: 'unknown', command: 'ls' }],
      aggregatedOutput: completed ? 'a.md\n' : null,
      exitCode: completed ? 0 : null,
      durationMs: completed ? 5 : null,
    };
  }

  function subagentChunks(): StreamChunk[] {
    return chunks.filter(chunk => chunk.type.startsWith('subagent_') && chunk.type !== 'subagent_update');
  }

  it('relays child tool calls keyed by the spawn tool call id', () => {
    parentSpawnCompleted();

    expect(child('item/started', { turnId: 'turn-c', item: commandItem('cmd-1', false) })).toBe(true);
    expect(child('item/completed', { turnId: 'turn-c', item: commandItem('cmd-1', true) })).toBe(true);

    expect(subagentChunks()).toEqual([
      { type: 'subagent_tool_use', subagentId: SPAWN_ID, id: 'cmd-1', name: 'Bash', input: { command: 'ls' } },
      { type: 'subagent_tool_result', subagentId: SPAWN_ID, id: 'cmd-1', content: 'a.md\n', isError: false },
    ]);
  });

  it('relays child text and separates consecutive messages', () => {
    parentSpawnCompleted();

    child('item/started', { turnId: 'turn-c', item: { type: 'agentMessage', id: 'm1', text: '', phase: 'commentary' } });
    child('item/agentMessage/delta', { turnId: 'turn-c', itemId: 'm1', delta: 'Looking' });
    child('item/agentMessage/delta', { turnId: 'turn-c', itemId: 'm1', delta: ' around.' });
    child('item/started', { turnId: 'turn-c', item: { type: 'agentMessage', id: 'm2', text: '', phase: 'final' } });
    child('item/agentMessage/delta', { turnId: 'turn-c', itemId: 'm2', delta: 'Done.' });

    expect(subagentChunks()).toEqual([
      { type: 'subagent_text', subagentId: SPAWN_ID, text: 'Looking' },
      { type: 'subagent_text', subagentId: SPAWN_ID, text: ' around.' },
      { type: 'subagent_text', subagentId: SPAWN_ID, text: '\n\nDone.' },
    ]);
    expect(relay.describeChild(CHILD)).toEqual({ subagentId: SPAWN_ID, finalText: 'Done.' });
  });

  it('drops usage, done, thinking, notices, plans, errors and hidden lifecycle tools', () => {
    parentSpawnCompleted();

    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    child('item/reasoning/summaryTextDelta', { turnId: 'turn-c', itemId: 'r1', summaryIndex: 0, delta: 'thinking' });
    child('thread/tokenUsage/updated', {
      turnId: 'turn-c',
      tokenUsage: {
        total: { totalTokens: 10, inputTokens: 8, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0 },
        last: { totalTokens: 10, inputTokens: 8, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0 },
        modelContextWindow: 200000,
      },
    });
    child('turn/plan/updated', { turnId: 'turn-c', explanation: null, plan: [{ step: 'x', status: 'pending' }] });
    child('model/rerouted', { turnId: 'turn-c', fromModel: 'a', toModel: 'b', reason: 'highRiskCyberActivity' });
    child('error', { turnId: 'turn-c', willRetry: false, error: { message: 'boom', codexErrorInfo: 'other', additionalDetails: null } });
    child('item/started', {
      turnId: 'turn-c',
      item: { type: 'collabAgentToolCall', id: 'grandchild-wait', tool: 'wait', status: 'inProgress', senderThreadId: CHILD, receiverThreadIds: [], agentsStates: {} },
    });
    child('item/completed', {
      turnId: 'turn-c',
      item: { type: 'collabAgentToolCall', id: 'grandchild-wait', tool: 'wait', status: 'completed', senderThreadId: CHILD, receiverThreadIds: [], agentsStates: {} },
    });
    child('turn/completed', { turn: { id: 'turn-c', items: [], status: 'failed', error: { message: 'x', codexErrorInfo: 'other', additionalDetails: null } } });

    expect(chunks).toEqual([]);
  });

  it('buffers child notifications until the spawn mapping is known, then flushes in order', () => {
    expect(childThreadStarted()).toBe(true);
    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    child('item/started', { turnId: 'turn-c', item: commandItem('cmd-1', false) });
    child('item/completed', { turnId: 'turn-c', item: commandItem('cmd-1', true) });

    expect(subagentChunks()).toEqual([]);

    parentSpawnCompleted();

    expect(subagentChunks().map(chunk => chunk.type)).toEqual(['subagent_tool_use', 'subagent_tool_result']);
  });

  it('bounds the pre-mapping buffer and drops the oldest notifications', () => {
    relay = new CodexChildThreadRelay((chunk) => chunks.push(chunk), { maxBufferedPerThread: 2 });
    relay.setParentThread(PARENT);
    childThreadStarted();

    for (let i = 1; i <= 3; i += 1) {
      child('item/started', { turnId: 'turn-c', item: commandItem(`cmd-${i}`, false) });
    }
    parentSpawnCompleted();

    expect(subagentChunks().map(chunk => (chunk as { id: string }).id)).toEqual(['cmd-2', 'cmd-3']);
  });

  it('buffers an unannounced thread and relays it once a spawn names it', () => {
    child('item/started', { turnId: 'turn-c', item: commandItem('cmd-1', false) });
    parentSpawnCompleted();

    expect(subagentChunks()).toEqual([
      expect.objectContaining({ type: 'subagent_tool_use', subagentId: SPAWN_ID, id: 'cmd-1' }),
    ]);
  });

  it('learns the mapping from a multi-agent v2 subAgentActivity started item', () => {
    relay.observeParentNotification('item/completed', {
      threadId: PARENT,
      turnId: 'turn-parent',
      item: { type: 'subAgentActivity', id: SPAWN_ID, kind: 'started', agentThreadId: CHILD, agentPath: '/root/writing_style' },
    });
    child('item/started', { turnId: 'turn-c', item: commandItem('cmd-1', false) });

    expect(subagentChunks()[0]).toMatchObject({ subagentId: SPAWN_ID, id: 'cmd-1' });
    expect(chunks).toContainEqual({
      type: 'subagent_update',
      subagentId: SPAWN_ID,
      update: { agentType: 'writing_style' },
    });
  });

  it('never consumes parent-thread traffic or threads that belong to another parent', () => {
    expect(relay.consumeNotification('item/agentMessage/delta', {
      threadId: PARENT, turnId: 't', itemId: 'm', delta: 'hi',
    })).toBe(false);
    expect(relay.consumeNotification('thread/started', { thread: { id: PARENT, parentThreadId: null, source: 'appServer' } }))
      .toBe(false);
    expect(childThreadStarted('thread-foreign', {
      parentThreadId: 'someone-else',
      source: { subAgent: { thread_spawn: { parent_thread_id: 'someone-else', depth: 1 } } },
    })).toBe(false);
    expect(child('item/started', { turnId: 't', item: commandItem('x', false) }, 'thread-foreign')).toBe(false);
    expect(relay.consumeNotification('item/started', { turnId: 't', item: {} })).toBe(false);
  });

  it('consumes nothing without a parent thread', () => {
    relay.setParentThread(null);
    expect(child('item/started', { turnId: 't', item: commandItem('x', false) })).toBe(false);
  });

  it('tracks the live child turn for interruptTarget', () => {
    parentSpawnCompleted();
    expect(relay.interruptTarget(SPAWN_ID)).toBeNull();

    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    expect(relay.interruptTarget(SPAWN_ID)).toEqual({ threadId: CHILD, turnId: 'turn-c' });
    expect(relay.interruptTarget('unknown-spawn', CHILD)).toEqual({ threadId: CHILD, turnId: 'turn-c' });
    expect(relay.interruptTarget('unknown-spawn')).toBeNull();

    child('turn/completed', { turn: { id: 'turn-c', items: [], status: 'completed', error: null } });
    expect(relay.interruptTarget(SPAWN_ID)).toBeNull();
  });

  it('keeps tracking the turn of a child whose mapping is still unknown', () => {
    childThreadStarted();
    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    parentSpawnCompleted();

    expect(relay.interruptTarget(SPAWN_ID)).toEqual({ threadId: CHILD, turnId: 'turn-c' });
  });

  it('reports model and agent type once, after the mapping is known', () => {
    childThreadStarted();
    expect(chunks).toEqual([]);

    parentSpawnCompleted(CHILD, SPAWN_ID, { prompt: 'Review the parser' });
    parentSpawnCompleted(CHILD, SPAWN_ID, { prompt: 'Review the parser' });

    expect(chunks.filter(chunk => chunk.type === 'subagent_update')).toEqual([{
      type: 'subagent_update',
      subagentId: SPAWN_ID,
      update: { agentType: 'shortcut_patterns', model: 'gpt-6-luna', prompt: 'Review the parser' },
    }]);
  });

  it('prefers the thread role for agentType and never forwards an encrypted prompt', () => {
    childThreadStarted(CHILD, { agentRole: 'explorer' });
    parentSpawnCompleted(CHILD, SPAWN_ID, { prompt: 'gAAAAABqmZ_tUVznNXRzJuF0ObJbwrreO4evv11WddBIa1phae3r1oFksM-aVYRqAUPsuU', model: 'gpt-6-sol' });

    expect(chunks).toContainEqual({
      type: 'subagent_update',
      subagentId: SPAWN_ID,
      update: { agentType: 'explorer', model: 'gpt-6-luna' },
    });
  });

  it('confirms a requested stop once the child turn ends interrupted', () => {
    parentSpawnCompleted();
    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    relay.markCancelRequested(CHILD);
    child('turn/completed', { turn: { id: 'turn-c', items: [], status: 'interrupted', error: null } });

    expect(chunks).toContainEqual({ type: 'subagent_update', subagentId: SPAWN_ID, update: { cancelled: true } });
  });

  it('does not claim a stop the user never asked for', () => {
    parentSpawnCompleted();
    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });
    relay.markCancelRequested(CHILD);
    relay.clearCancelRequested(CHILD);
    child('turn/completed', { turn: { id: 'turn-c', items: [], status: 'interrupted', error: null } });

    expect(chunks.some(chunk => chunk.type === 'subagent_update' && chunk.update.cancelled)).toBe(false);
  });

  it('forgets every child when the parent thread changes', () => {
    parentSpawnCompleted();
    child('turn/started', { turn: { id: 'turn-c', items: [], status: 'inProgress', error: null } });

    relay.setParentThread(PARENT);
    expect(relay.interruptTarget(SPAWN_ID)).not.toBeNull();

    relay.setParentThread('thread-new');
    expect(relay.interruptTarget(SPAWN_ID)).toBeNull();
    expect(relay.describeChild(CHILD)).toBeUndefined();
  });

  it('reset forgets children but keeps the parent thread', () => {
    parentSpawnCompleted();
    relay.reset();

    expect(relay.describeChild(CHILD)).toBeUndefined();
    expect(relay.getParentThreadId()).toBe(PARENT);
  });
});
