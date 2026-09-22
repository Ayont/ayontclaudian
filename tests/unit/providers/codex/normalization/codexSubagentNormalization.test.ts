import { TOOL_SPAWN_AGENT, TOOL_WAIT_AGENT } from '@/core/tools/toolNames';
import type { ToolCallInfo } from '@/core/types';
import {
  buildCodexSubagentInfo,
  codexSubagentLifecycleAdapter,
  extractCodexSpawnResult,
  extractCodexWaitResult,
} from '@/providers/codex/normalization/codexSubagentNormalization';

describe('codexSubagentNormalization', () => {
  it('extracts agent id and nickname from spawn result', () => {
    expect(
      extractCodexSpawnResult('{"agent_id":"agent-1","nickname":"Zeno"}')
    ).toEqual({
      agentId: 'agent-1',
      nickname: 'Zeno',
    });
  });

  it('extracts wait statuses and timeout flag', () => {
    expect(
      extractCodexWaitResult(
        '{"status":{"agent-1":{"completed":"done"}},"timed_out":false}'
      )
    ).toEqual({
      statuses: {
        'agent-1': { completed: 'done' },
      },
      timedOut: false,
    });
  });

  it('builds completed subagent info from spawn and wait tools', () => {
    const spawnTool: ToolCallInfo = {
      id: 'spawn-1',
      name: TOOL_SPAWN_AGENT,
      input: {
        message: 'Inspect the code and patch the bug.',
        model: 'gpt-5.4-mini',
      },
      status: 'completed',
      result: '{"agent_id":"agent-1","nickname":"Zeno"}',
    };
    const waitTool: ToolCallInfo = {
      id: 'wait-1',
      name: TOOL_WAIT_AGENT,
      input: { targets: ['agent-1'], timeout_ms: 30_000 },
      status: 'completed',
      result: '{"status":{"agent-1":{"completed":"Patched the bug and ran the tests."}},"timed_out":false}',
    };

    expect(buildCodexSubagentInfo(spawnTool, [spawnTool, waitTool])).toEqual(
      expect.objectContaining({
        id: 'spawn-1',
        description: 'Zeno (gpt-5.4-mini)',
        prompt: 'Inspect the code and patch the bug.',
        status: 'completed',
        result: 'Patched the bug and ran the tests.',
        agentId: 'agent-1',
      })
    );
  });

  it('keeps the subagent running after spawn completes but before wait resolves', () => {
    const spawnTool: ToolCallInfo = {
      id: 'spawn-1',
      name: TOOL_SPAWN_AGENT,
      input: { message: 'Do work', model: 'gpt-5.4-mini' },
      status: 'completed',
      result: '{"agent_id":"agent-1","nickname":"Zeno"}',
    };

    expect(buildCodexSubagentInfo(spawnTool, [spawnTool])).toEqual(
      expect.objectContaining({
        description: 'Zeno (gpt-5.4-mini)',
        prompt: 'Do work',
        status: 'running',
        result: undefined,
      })
    );
  });
});

describe('codexSubagentLifecycleAdapter (app-server v2)', () => {
  const FERNET_TOKEN = 'gAAAAABqmZ_tUVznNXRzJuF0ObJbwrreO4evv11WddBIa1phae3r1oFksM-aVYRqAUPsuUjuT07P_73OSNO1kGUAJhlffUhxGtMSXWE9';

  function spawnTool(overrides: Partial<ToolCallInfo> = {}): ToolCallInfo {
    return {
      id: 'call_spawn',
      name: TOOL_SPAWN_AGENT,
      input: { prompt: 'Review the parser', model: 'gpt-6-sol' },
      status: 'completed',
      result: JSON.stringify({
        agent_id: 'thread-child',
        receiver_thread_ids: ['thread-child'],
        agents_states: { 'thread-child': { status: 'pendingInit' } },
      }),
      ...overrides,
    };
  }

  function waitTool(states: Record<string, unknown>, id = 'call_wait'): ToolCallInfo {
    return {
      id,
      name: 'wait',
      input: { receiver_thread_ids: Object.keys(states) },
      status: 'completed',
      result: JSON.stringify({ receiver_thread_ids: Object.keys(states), agents_states: states }),
    };
  }

  it('classifies the newer collab tools as hidden, non-card tools', () => {
    for (const name of ['send_message', 'followup_task', 'list_agents', 'interrupt_agent', 'subagent_activity']) {
      expect(codexSubagentLifecycleAdapter.isHiddenTool(name)).toBe(true);
      expect(codexSubagentLifecycleAdapter.isSpawnTool(name)).toBe(false);
    }
    expect(codexSubagentLifecycleAdapter.isHiddenTool('wait')).toBe(true);
    expect(codexSubagentLifecycleAdapter.isHiddenTool('close_agent')).toBe(true);
    expect(codexSubagentLifecycleAdapter.isHiddenTool('send_input')).toBe(false);
    expect(codexSubagentLifecycleAdapter.isHiddenTool('spawn_agent')).toBe(false);
  });

  it('treats status-reporting tools as wait tools and close_agent as the close tool', () => {
    for (const name of ['wait', 'wait_agent', 'interrupt_agent', 'list_agents', 'subagent_activity']) {
      expect(codexSubagentLifecycleAdapter.isWaitTool(name)).toBe(true);
    }
    expect(codexSubagentLifecycleAdapter.isWaitTool('send_message')).toBe(false);
    expect(codexSubagentLifecycleAdapter.isCloseTool('close_agent')).toBe(true);
    expect(codexSubagentLifecycleAdapter.isCloseTool('interrupt_agent')).toBe(false);
  });

  it('reads prompt, model, agent id and provider from a v2 spawn', () => {
    const spawn = spawnTool();

    expect(buildCodexSubagentInfo(spawn, [spawn])).toEqual(expect.objectContaining({
      id: 'call_spawn',
      prompt: 'Review the parser',
      model: 'gpt-6-sol',
      providerId: 'codex',
      agentId: 'thread-child',
      status: 'running',
      description: 'Codex subagent (gpt-6-sol)',
    }));
  });

  it('never shows an encrypted spawn message as the prompt; the task name labels the card', () => {
    const spawn = spawnTool({
      input: { task_name: 'shortcut_patterns', fork_turns: 'all', message: FERNET_TOKEN },
      result: '{"task_name":"/root/shortcut_patterns"}',
    });

    const info = buildCodexSubagentInfo(spawn, [spawn]);

    expect(info.prompt).toBe('');
    expect(info.description).toBe('shortcut_patterns');
    expect(info.agentType).toBe('shortcut_patterns');
  });

  it('prefers an explicit role over the task name for agentType', () => {
    const spawn = spawnTool({ input: { message: 'Do it', agent_type: 'code-writer', task_name: 'refactor' } });
    expect(buildCodexSubagentInfo(spawn, [spawn]).agentType).toBe('code-writer');
  });

  it.each([
    [{ status: 'completed', message: 'All tests pass.' }, 'completed', 'All tests pass.', undefined],
    [{ status: 'errored', message: 'Sandbox denied' }, 'error', 'Sandbox denied', undefined],
    [{ status: 'notFound' }, 'error', 'Subagent nicht gefunden', undefined],
    [{ status: 'interrupted' }, 'error', 'Subagent gestoppt', 'cancelled'],
    [{ status: 'shutdown' }, 'completed', undefined, undefined],
    [{ status: 'shutdown', message: 'Crashed' }, 'error', 'Crashed', undefined],
    [{ status: 'running' }, 'running', undefined, undefined],
    [{ status: 'pendingInit' }, 'running', undefined, undefined],
  ])('maps agent state %j to %s', (state, status, result, cancelState) => {
    const spawn = spawnTool();
    const info = buildCodexSubagentInfo(spawn, [spawn, waitTool({ 'thread-child': state })]);

    expect(info.status).toBe(status);
    expect(info.result).toBe(result);
    expect(info.cancelState).toBe(cancelState);
  });

  it('lets the latest decisive state win and keeps the earlier result text', () => {
    const spawn = spawnTool();
    const siblings = [
      spawn,
      waitTool({ 'thread-child': { status: 'interrupted' } }, 'w1'),
      waitTool({ 'thread-child': { status: 'completed', message: 'Recovered and done.' } }, 'w2'),
      waitTool({ 'thread-child': { status: 'shutdown' } }, 'w3'),
    ];

    const info = buildCodexSubagentInfo(spawn, siblings);

    expect(info.status).toBe('completed');
    expect(info.result).toBe('Recovered and done.');
    expect(info.cancelState).toBeUndefined();
  });

  it('does not let a later legacy timeout undo a completion', () => {
    const spawn: ToolCallInfo = {
      id: 'spawn-1',
      name: TOOL_SPAWN_AGENT,
      input: { message: 'Do work' },
      status: 'completed',
      result: '{"agent_id":"agent-1"}',
    };
    const done: ToolCallInfo = {
      id: 'wait-1',
      name: TOOL_WAIT_AGENT,
      input: { targets: ['agent-1'] },
      status: 'completed',
      result: '{"status":{"agent-1":{"completed":"Finished."}},"timed_out":false}',
    };
    const laterTimeout: ToolCallInfo = {
      id: 'wait-2',
      name: TOOL_WAIT_AGENT,
      input: { targets: ['agent-2'] },
      status: 'completed',
      result: '{"status":{},"timed_out":true}',
    };

    expect(buildCodexSubagentInfo(spawn, [spawn, done, laterTimeout])).toEqual(expect.objectContaining({
      status: 'completed',
      result: 'Finished.',
    }));
  });

  it('ignores agent states that belong to another child', () => {
    const spawn = spawnTool();
    const info = buildCodexSubagentInfo(spawn, [spawn, waitTool({ 'thread-other': { status: 'completed', message: 'x' } })]);
    expect(info.status).toBe('running');
  });

  it('settles a multi-agent v2 spawn through its linked subagent_activity call', () => {
    const spawn = spawnTool({
      input: { task_name: 'writing_style', message: FERNET_TOKEN },
      result: '{"task_name":"/root/writing_style"}',
    });
    const activity: ToolCallInfo = {
      id: 'subagent-completed-1',
      name: 'subagent_activity',
      input: { targets: ['thread-child'], agent_path: '/root/writing_style', kind: 'completed', spawn_tool_id: 'call_spawn' },
      status: 'completed',
      result: JSON.stringify({ agents_states: { 'thread-child': { status: 'completed', message: 'Final answer' } } }),
    };

    expect(buildCodexSubagentInfo(spawn, [spawn, activity])).toEqual(expect.objectContaining({
      status: 'completed',
      result: 'Final answer',
      agentId: 'thread-child',
    }));
  });

  it('resolves spawn ids from agent states, receiver ids and explicit links', () => {
    const map = new Map([['thread-a', 'spawn-a'], ['thread-b', 'spawn-b'], ['thread-c', 'spawn-c']]);

    const wait: ToolCallInfo = {
      id: 'w',
      name: 'wait',
      input: { receiver_thread_ids: ['thread-b'] },
      status: 'completed',
      result: JSON.stringify({ agents_states: { 'thread-a': { status: 'completed' } } }),
    };
    expect(codexSubagentLifecycleAdapter.resolveSpawnToolIds(wait, map).sort()).toEqual(['spawn-a', 'spawn-b']);

    const activity: ToolCallInfo = {
      id: 'act',
      name: 'subagent_activity',
      input: { targets: ['thread-unknown'], spawn_tool_id: 'spawn-direct' },
      status: 'completed',
      result: '{}',
    };
    expect(codexSubagentLifecycleAdapter.resolveSpawnToolIds(activity, map)).toEqual(['spawn-direct']);
  });

  it('extractSpawnResult reads the v2 summary agent id', () => {
    expect(codexSubagentLifecycleAdapter.extractSpawnResult(spawnTool().result)).toEqual(
      expect.objectContaining({ agentId: 'thread-child' }),
    );
  });
});
