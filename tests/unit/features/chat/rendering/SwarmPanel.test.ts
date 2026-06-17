import { createMockEl } from '@test/helpers/mockElement';

import type { SubagentInfo } from '@/core/types';
import { SwarmPanel } from '@/features/chat/rendering/SwarmPanel';

function makeAgent(partial: Partial<SubagentInfo>): SubagentInfo {
  return {
    id: 'x',
    description: 'Agent',
    isExpanded: false,
    status: 'running',
    toolCalls: [],
    ...partial,
  };
}

interface FakeManager {
  manager: {
    onSwarmChange: (fn: () => void) => () => void;
    getAllSubagents: () => SubagentInfo[];
  };
  fire: () => void;
}

function fakeManager(getAgents: () => SubagentInfo[]): FakeManager {
  let listener: (() => void) | null = null;
  return {
    manager: {
      onSwarmChange: (fn: () => void) => {
        listener = fn;
        return () => {
          listener = null;
        };
      },
      getAllSubagents: getAgents,
    },
    fire: () => listener?.(),
  };
}

describe('SwarmPanel', () => {
  let mountEl: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mountEl = createMockEl('div');
    // Make scheduleRender synchronous for deterministic assertions.
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function build(agents: SubagentInfo[], messagesEl: any = createMockEl('div')) {
    const fake = fakeManager(() => agents);
    const panel = new SwarmPanel({
      manager: fake.manager as never,
      mountEl,
      getMessagesEl: () => messagesEl,
    });
    return { panel, fire: fake.fire };
  }

  it('stays hidden when there are no subagents', () => {
    build([]);
    const root = mountEl.querySelector('.claudian-swarm-panel');
    expect(root.hasClass('claudian-hidden')).toBe(true);
  });

  it('shows the panel with a count and one row per agent', () => {
    build([
      makeAgent({ id: 'a', description: 'Alpha' }),
      makeAgent({ id: 'b', description: 'Beta', status: 'completed' }),
    ]);

    const root = mountEl.querySelector('.claudian-swarm-panel');
    expect(root.hasClass('claudian-hidden')).toBe(false);
    expect(mountEl.querySelector('.claudian-swarm-count').textContent).toBe('2');
    expect(mountEl.querySelectorAll('.claudian-swarm-agent')).toHaveLength(2);
  });

  it('marks the panel as having running agents', () => {
    build([makeAgent({ id: 'a', status: 'running' })]);
    const root = mountEl.querySelector('.claudian-swarm-panel');
    expect(root.hasClass('has-running')).toBe(true);
  });

  it('applies a status class per agent state', () => {
    build([makeAgent({ id: 'a', status: 'error' })]);
    const row = mountEl.querySelector('.claudian-swarm-agent');
    expect(row.hasClass('status-error')).toBe(true);
  });

  it('renders the latest tool call as the activity line ("where it codes")', () => {
    build([
      makeAgent({
        id: 'a',
        toolCalls: [
          { id: 't1', name: 'Read', input: { file_path: '/x.ts' }, status: 'completed', isExpanded: false },
          { id: 't2', name: 'Edit', input: { file_path: '/src/foo.ts' }, status: 'running', isExpanded: false },
        ],
      }),
    ]);

    const activity = mountEl.querySelector('.claudian-swarm-agent-activity-text');
    expect(activity.textContent).toContain('Edit');
    expect(activity.textContent).toContain('foo.ts');
  });

  it('shows an async mode badge', () => {
    build([makeAgent({ id: 'a', mode: 'async', asyncStatus: 'running' })]);
    const badge = mountEl.querySelector('.claudian-swarm-agent-mode');
    expect(badge.textContent).toBe('async');
  });

  it('shows a duration for finished agents', () => {
    build([
      makeAgent({ id: 'a', status: 'completed', startedAt: 1000, completedAt: 6000 }),
    ]);
    const duration = mountEl.querySelector('.claudian-swarm-agent-duration');
    expect(duration.textContent).toBe('5s');
  });

  it('shows a live, ticking duration for running agents', () => {
    const fake = fakeManager(() => [
      makeAgent({ id: 'a', status: 'running', startedAt: 1000 }),
    ]);
    const panel = new SwarmPanel(
      { manager: fake.manager as never, mountEl, getMessagesEl: () => createMockEl('div') },
      () => 13_000, // now: 12s after startedAt
    );
    const duration = mountEl.querySelector('.claudian-swarm-agent-duration');
    expect(duration.hasClass('is-live')).toBe(true);
    expect(duration.textContent).toBe('12s');
    panel.destroy();
  });

  it('toggles the list open/closed', () => {
    build([makeAgent({ id: 'a' })]);
    const root = mountEl.querySelector('.claudian-swarm-panel');
    expect(root.hasClass('is-open')).toBe(true);

    mountEl.querySelector('.claudian-swarm-toggle').click();
    expect(root.hasClass('is-open')).toBe(false);
  });

  it('re-renders when the manager fires a swarm change', () => {
    const agents: SubagentInfo[] = [];
    const fake = fakeManager(() => agents);
    new SwarmPanel({
      manager: fake.manager as never,
      mountEl,
      getMessagesEl: () => createMockEl('div'),
    });

    const root = mountEl.querySelector('.claudian-swarm-panel');
    expect(root.hasClass('claudian-hidden')).toBe(true);

    agents.push(makeAgent({ id: 'a' }));
    fake.fire();

    expect(root.hasClass('claudian-hidden')).toBe(false);
    expect(mountEl.querySelector('.claudian-swarm-count').textContent).toBe('1');
  });

  it('focuses the inline block on row click', () => {
    const target = createMockEl('div');
    const scrollSpy = jest.spyOn(target, 'scrollIntoView');
    const messagesEl = createMockEl('div');
    messagesEl.querySelector = () => target;

    build([makeAgent({ id: 'agent-7', description: 'Worker' })], messagesEl);

    mountEl.querySelector('.claudian-swarm-agent').click();

    expect(scrollSpy).toHaveBeenCalled();
    expect(target.hasClass('claudian-swarm-flash')).toBe(true);
  });

  it('cleans up its DOM and subscription on destroy', () => {
    const { panel } = build([makeAgent({ id: 'a' })]);
    const removeSpy = jest.spyOn(mountEl.querySelector('.claudian-swarm-panel'), 'remove');
    panel.destroy();
    expect(removeSpy).toHaveBeenCalled();
  });
});
