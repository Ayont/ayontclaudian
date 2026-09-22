import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';

import { createSubagentBlock } from '@/features/chat/rendering/SubagentRenderer';
import { SubagentManager } from '@/features/chat/services/SubagentManager';

/**
 * Live telemetry, the subagent's own transcript and the stop lifecycle: the
 * data the inline card, the inspector tab and the swarm panel all read.
 */
describe('SubagentManager — live subagents', () => {
  let manager: SubagentManager;
  let parentEl: any;
  let swarmChanges: number;

  beforeEach(() => {
    manager = new SubagentManager(() => {});
    manager.setProviderResolver(() => 'claude');
    parentEl = createMockEl('div');
    swarmChanges = 0;
    manager.onSwarmChange(() => { swarmChanges++; });
  });

  function startSync(id = 'toolu_agent'): void {
    manager.handleTaskToolUse(id, { run_in_background: false, description: 'Firewall prüfen', prompt: 'Prüfe Regel 12' }, parentEl);
  }

  it('stamps the provider on every subagent it tracks', () => {
    startSync();

    expect(manager.getSubagentById('toolu_agent')?.providerId).toBe('claude');
  });

  it('applies provider telemetry to the subagent and redraws its card', () => {
    startSync();
    const before = swarmChanges;

    manager.applyLiveUpdate('toolu_agent', {
      taskId: 'a53054abb0493d657',
      agentType: 'general-purpose',
      activity: 'Running sleep 25 && echo slept',
      totalTokens: 15853,
      toolUses: 1,
    });

    const info = manager.getSubagentById('toolu_agent');
    expect(info).toMatchObject({ taskId: 'a53054abb0493d657', agentType: 'general-purpose', totalTokens: 15853 });
    expect(parentEl.querySelector('.claudian-subagent-activity-text').textContent).toBe('Running sleep 25 && echo slept');
    expect(swarmChanges).toBeGreaterThan(before);
  });

  // task_started can arrive before the Agent tool call has decided sync vs async.
  it('keeps telemetry for a task that is not rendered yet', () => {
    manager.handleTaskToolUse('toolu_agent', { description: 'Noch offen' }, parentEl);
    manager.applyLiveUpdate('toolu_agent', { taskId: 'task-1', agentType: 'Explore' });

    manager.renderPendingTask('toolu_agent', parentEl);

    expect(manager.getSubagentById('toolu_agent')).toMatchObject({ taskId: 'task-1', agentType: 'Explore' });
  });

  it('records what the subagent writes and does, in order', () => {
    startSync();
    manager.appendText('toolu_agent', 'Ich prüfe ');
    manager.appendText('toolu_agent', 'die Regeln.');
    manager.addSyncToolCall('toolu_agent', { id: 't1', name: 'Read', input: { file_path: '/v/a.md' }, status: 'running' });

    expect(manager.getSubagentById('toolu_agent')?.timeline).toEqual([
      { type: 'text', text: 'Ich prüfe die Regeln.', at: expect.any(Number), seq: 0 },
      { type: 'tool', toolId: 't1', at: expect.any(Number), seq: 1 },
    ]);
  });

  it('tracks a stop from request to provider confirmation', () => {
    startSync();

    manager.requestCancel('toolu_agent');
    expect(manager.getSubagentById('toolu_agent')?.cancelState).toBe('requested');
    expect(parentEl.querySelector('.claudian-subagent-status-text').textContent).toBe('Wird gestoppt');

    manager.applyLiveUpdate('toolu_agent', { cancelled: true });
    expect(manager.getSubagentById('toolu_agent')?.cancelState).toBe('cancelled');
    expect(parentEl.querySelector('.claudian-subagent-status-text').textContent).toBe('Gestoppt');
  });

  it('withdraws a stop request the provider refused', () => {
    startSync();
    manager.requestCancel('toolu_agent');

    manager.clearCancelRequest('toolu_agent');

    expect(manager.getSubagentById('toolu_agent')?.cancelState).toBeUndefined();
  });

  it('does not stop a subagent that already finished', () => {
    startSync();
    manager.finalizeSyncSubagent('toolu_agent', 'fertig', false);

    expect(manager.requestCancel('toolu_agent')).toBeUndefined();
    expect(manager.getSubagentById('toolu_agent')?.cancelState).toBeUndefined();
  });

  // Codex spawns agents through its own lifecycle tools; they used to bypass the
  // registry, so the swarm panel and the inspector never saw them.
  it('tracks provider lifecycle subagents and their child tools', () => {
    const state = createSubagentBlock(parentEl, 'spawn-1', { description: 'Tests schreiben' });
    manager.trackLifecycleSubagent(state);

    manager.addChildToolCall('spawn-1', { id: 'c1', name: 'Bash', input: { command: 'npm test' }, status: 'running' });
    manager.updateChildToolResult('spawn-1', 'c1', { id: 'c1', name: 'Bash', input: { command: 'npm test' }, status: 'completed', result: 'ok' });

    const info = manager.getSubagentById('spawn-1');
    expect(info?.providerId).toBe('claude');
    expect(info?.toolCalls).toEqual([expect.objectContaining({ id: 'c1', status: 'completed' })]);
    expect(parentEl.querySelector('.claudian-subagent-trail').children).toHaveLength(1);
  });

  it('collects child tools of a background agent instead of dropping them', () => {
    manager.handleTaskToolUse('toolu_bg', { run_in_background: true, description: 'Hintergrund' }, parentEl);

    manager.addChildToolCall('toolu_bg', { id: 'c1', name: 'Grep', input: { pattern: 'fax' }, status: 'running' });

    expect(manager.getSubagentById('toolu_bg')?.toolCalls).toEqual([expect.objectContaining({ id: 'c1' })]);
  });

  it('writes the orphan notice in German', () => {
    manager.handleTaskToolUse('toolu_bg', { run_in_background: true, description: 'Hintergrund' }, parentEl);

    const [orphaned] = manager.orphanAllActive();

    expect(orphaned.result).toBe('Der Chat endete, bevor der Subagent fertig war.');
  });
});

describe('SubagentManager — providers without background agents', () => {
  // OpenCode, OMP, Hermes, Kimi and Cline send the whole Agent call at once and
  // never say run_in_background; waiting for it hid the card until the agent
  // had already finished.
  it('shows the card while the agent runs instead of after its result', () => {
    const manager = new SubagentManager(() => {});
    manager.setProviderResolver(() => 'opencode');

    const result = manager.handleTaskToolUse('call_1', { description: 'Tests schreiben', subagent_type: 'general' }, createMockEl('div'));

    expect(result.action).toBe('created_sync');
    expect(manager.getSubagentById('call_1')?.agentType).toBe('general');
  });

  // Claude streams the Agent input in pieces; its mode stays open until known.
  it('keeps waiting for Claude to say whether the agent runs in the background', () => {
    const manager = new SubagentManager(() => {});
    manager.setProviderResolver(() => 'claude');

    expect(manager.handleTaskToolUse('toolu_1', { description: 'Noch offen' }, createMockEl('div')).action).toBe('buffered');
  });
});

// A turn that ends (or is cancelled) stops delivering this agent's events; left
// alone, its card ticked and said "Läuft" forever, and was saved that way.
describe('SubagentManager — turn end', () => {
  function started(): SubagentManager {
    const manager = new SubagentManager(() => {});
    manager.setProviderResolver(() => 'claude');
    manager.handleTaskToolUse('toolu_1', { run_in_background: false, description: 'Läuft noch' }, createMockEl('div'));
    return manager;
  }

  it('settles a foreground agent the turn left unfinished', () => {
    const manager = started();
    const info = manager.getSubagentById('toolu_1');

    manager.resetStreamingState();

    expect(info).toMatchObject({ status: 'error', asyncStatus: 'orphaned', result: 'Die Antwort endete, bevor der Subagent fertig war.' });
    expect(info?.completedAt).toEqual(expect.any(Number));
  });

  it('turns a pending stop into a stop once the turn is over', () => {
    const manager = started();
    manager.requestCancel('toolu_1');

    manager.resetStreamingState();

    expect(manager.getSubagentById('toolu_1')).toMatchObject({ status: 'error', cancelState: 'cancelled' });
  });

  it('leaves finished agents alone', () => {
    const manager = started();
    manager.finalizeSyncSubagent('toolu_1', 'fertig', false);

    manager.resetStreamingState();

    expect(manager.getSubagentById('toolu_1')).toMatchObject({ status: 'completed', result: 'fertig' });
  });

  it('also settles provider lifecycle agents that can no longer report', () => {
    const manager = new SubagentManager(() => {});
    const state = createSubagentBlock(createMockEl('div'), 'spawn-1', { description: 'Codex-Kind' });
    manager.trackLifecycleSubagent(state);

    manager.resetStreamingState();

    expect(manager.getSubagentById('spawn-1')?.asyncStatus).toBe('orphaned');
  });

  // Background agents keep running after the turn and report later.
  it('keeps background agents live', () => {
    const manager = new SubagentManager(() => {});
    manager.handleTaskToolUse('toolu_bg', { run_in_background: true, description: 'Hintergrund' }, createMockEl('div'));

    manager.resetStreamingState();

    expect(manager.getSubagentById('toolu_bg')?.status).toBe('running');
  });
});
