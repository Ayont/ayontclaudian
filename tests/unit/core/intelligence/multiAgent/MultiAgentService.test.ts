import type { MissionState, MissionStateStorage } from '../../../../../src/core/intelligence/multiAgent/MissionStateStorage';
import { buildSynthesisPrompt, estimateTokens, MultiAgentService } from '../../../../../src/core/intelligence/multiAgent/MultiAgentService';

describe('MultiAgentService', () => {
  it('registers and lists agents', () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'coder', name: 'Coder', role: 'code', systemPrompt: 'You code.' });
    expect(service.listAgents()).toHaveLength(1);
  });

  it('runs tasks across agents', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });
    service.registerAgent({ id: 'b', name: 'B', role: 'b', systemPrompt: 'B' });

    const results = await service.runTask(
      { id: 't1', prompt: 'hello', agents: ['a', 'b'] },
      {
        execute: async (agent) => `${agent.name}: ${agent.systemPrompt}`,
      },
    );

    expect(results).toHaveLength(2);
    expect(results[0].output).toContain('A');
  });

  it('runMission runs specialists then synthesizes a combined result', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });
    service.registerAgent({ id: 'b', name: 'B', role: 'b', systemPrompt: 'B' });

    const progressEvents: string[] = [];
    let clock = 0;
    const outcome = await service.runMission(
      { id: 'm1', prompt: 'build', agents: ['a', 'b'] },
      { execute: async (agent) => `output from ${agent.name}` },
      {
        synthesize: async (_prompt, contributions) =>
          `SYNTH(${contributions.map((c) => c.agent.name).join('+')})`,
      },
      (p) => progressEvents.push(p.status),
      () => (clock += 5),
    );

    expect(outcome.results).toHaveLength(2);
    expect(outcome.synthesis).toBe('SYNTH(A+B)');
    // Went through a synthesizing phase and ended completed.
    expect(progressEvents).toContain('synthesizing');
    expect(progressEvents.at(-1)).toBe('completed');
  });

  it('runMission tracks per-agent tokens and duration', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    let last: { agents: { tokens?: number; durationMs?: number; status: string }[] } | null = null;
    let clock = 0;
    await service.runMission(
      { id: 'm2', prompt: 'x', agents: ['a'] },
      { execute: async (_a, _p, onChunk) => { onChunk('a', 'hello world'); return 'hello world'; } },
      undefined,
      (p) => { last = p; },
      () => (clock += 100),
    );

    expect(last).not.toBeNull();
    const agent = last!.agents[0];
    expect(agent.status).toBe('done');
    expect(agent.tokens).toBe(estimateTokens('hello world'));
    expect(agent.durationMs).toBeGreaterThan(0);
  });

  it('runMission skips synthesis when all specialists fail', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    let synthesizeCalled = false;
    const outcome = await service.runMission(
      { id: 'm3', prompt: 'x', agents: ['a'] },
      { execute: async () => { throw new Error('boom'); } },
      { synthesize: async () => { synthesizeCalled = true; return 'never'; } },
    );

    expect(synthesizeCalled).toBe(false);
    expect(outcome.synthesis).toBe('');
  });

  it('runMission persists state and emits events when storage is supplied', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    const saved: MissionState[] = [];
    const events: { type: string; agentId?: string }[] = [];
    const storage = {
      saveMission: async (state: MissionState) => { saved.push(state); },
      appendEvent: async (_taskId: string, event: { type: string; agentId?: string }) => { events.push(event); },
    } as unknown as MissionStateStorage;

    await service.runMission(
      { id: 'm4', prompt: 'x', agents: ['a'] },
      { execute: async () => 'result' },
      undefined,
      undefined,
      undefined,
      { storage },
    );

    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved.at(-1)?.status).toBe('completed');
    expect(events.some((e) => e.type === 'started')).toBe(true);
    expect(events.some((e) => e.type === 'agent-done' && e.agentId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'completed')).toBe(true);
  });

  it('resumeMission reuses done agents and re-runs errored agents', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });
    service.registerAgent({ id: 'b', name: 'B', role: 'b', systemPrompt: 'B' });

    const state: MissionState = {
      taskId: 'm5',
      prompt: 'x',
      agentIds: ['a', 'b'],
      status: 'error',
      overall: 50,
      agents: [
        { agentId: 'a', status: 'done', progress: 100, output: 'kept-a' },
        { agentId: 'b', status: 'error', progress: 100, output: 'failed-b' },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    const executed: string[] = [];
    const outcome = await service.resumeMission(
      state,
      { execute: async (agent) => { executed.push(agent.id); return `rerun-${agent.id}`; } },
      undefined,
      undefined,
      undefined,
    );

    expect(executed).toEqual(['b']);
    expect(outcome.results.find((r) => r.agentId === 'a')?.output).toBe('kept-a');
    expect(outcome.results.find((r) => r.agentId === 'b')?.output).toBe('rerun-b');
  });

  it('resumeMission runs synthesis when enough agents succeed', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    const state: MissionState = {
      taskId: 'm6',
      prompt: 'x',
      agentIds: ['a'],
      status: 'running',
      overall: 100,
      agents: [{ agentId: 'a', status: 'done', progress: 100, output: 'kept-a' }],
      createdAt: 1,
      updatedAt: 2,
    };

    const outcome = await service.resumeMission(
      state,
      { execute: async () => { throw new Error('should not run'); } },
      { synthesize: async (_prompt, contributions) => `SYNTH(${contributions.map((c) => c.agent.name).join(',')})` },
    );

    expect(outcome.synthesis).toBe('SYNTH(A)');
  });

  it('buildSynthesisPrompt requests conflict resolution and citations', () => {
    const prompt = buildSynthesisPrompt('task-x', [
      { agent: { name: 'A', role: 'a' }, output: 'out-a' },
      { agent: { name: 'B', role: 'b' }, output: 'out-b' },
    ]);

    expect(prompt).toContain('task-x');
    expect(prompt).toContain('A');
    expect(prompt).toContain('out-a');
    expect(prompt.toLowerCase()).toContain('resolve conflicts');
    expect(prompt.toLowerCase()).toContain('de-duplicate');
    expect(prompt.toLowerCase()).toContain('cite');
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});
