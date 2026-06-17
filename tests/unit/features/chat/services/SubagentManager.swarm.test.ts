import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import { SubagentManager } from '@/features/chat/services/SubagentManager';

/**
 * Covers the swarm-overview API added for the multi-agent visualization:
 * getAllSubagents / getSubagentById / onSwarmChange and the registry's
 * persistence across the sync finalize + clear lifecycle.
 */
describe('SubagentManager — swarm overview', () => {
  let manager: SubagentManager;
  let parentEl: any;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SubagentManager(() => {});
    parentEl = createMockEl('div');
  });

  it('registers an async subagent and exposes it via getAllSubagents', () => {
    manager.handleTaskToolUse(
      'task-1',
      { run_in_background: true, description: 'Build API', prompt: 'do it' },
      parentEl,
    );

    const all = manager.getAllSubagents();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('task-1');
    expect(all[0].mode).toBe('async');
    expect(all[0].description).toBe('Build API');
    expect(manager.getSubagentById('task-1')).toBe(all[0]);
  });

  it('retains a sync subagent after finalize and reflects completion + tools', () => {
    manager.handleTaskToolUse(
      'task-2',
      { run_in_background: false, description: 'Refactor', prompt: 'x' },
      parentEl,
    );
    manager.addSyncToolCall('task-2', {
      id: 't1',
      name: 'Edit',
      input: { file_path: '/a.ts' },
      status: 'running',
      isExpanded: false,
    });

    let info = manager.getSubagentById('task-2');
    expect(info).toBeDefined();
    expect(info?.toolCalls).toHaveLength(1);

    manager.finalizeSyncSubagent('task-2', 'all done', false);

    info = manager.getSubagentById('task-2');
    expect(info?.status).toBe('completed');
    expect(info?.completedAt).toBeDefined();
    // Still present in the registry even though removed from the live sync map.
    expect(manager.getAllSubagents()).toHaveLength(1);
  });

  it('notifies swarm listeners on create and finalize, and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = manager.onSwarmChange(listener);

    manager.handleTaskToolUse(
      'task-3',
      { run_in_background: false, description: 'd', prompt: '' },
      parentEl,
    );
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    manager.finalizeSyncSubagent('task-3', 'r', false);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    manager.clear();
    expect(listener).not.toHaveBeenCalled();
  });

  it('orders agents by start order', () => {
    manager.handleTaskToolUse('a', { run_in_background: true, description: 'A', prompt: '' }, parentEl);
    manager.handleTaskToolUse('b', { run_in_background: true, description: 'B', prompt: '' }, parentEl);

    expect(manager.getAllSubagents().map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('clear empties the registry and notifies', () => {
    manager.handleTaskToolUse('task-x', { run_in_background: true, description: 'X', prompt: '' }, parentEl);
    const listener = jest.fn();
    manager.onSwarmChange(listener);

    manager.clear();

    expect(manager.getAllSubagents()).toHaveLength(0);
    expect(listener).toHaveBeenCalled();
  });
});
