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
    expect(saved.at(-1)?.completedAt).toEqual(expect.any(Number));
    expect(events.some((e) => e.type === 'started')).toBe(true);
    expect(events.some((e) => e.type === 'agent-done' && e.agentId === 'a')).toBe(true);
    expect(events.some((e) => e.type === 'completed')).toBe(true);
  });

  it('persists a failed synthesis as a retryable mission error and rejects the run', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    const saved: MissionState[] = [];
    const events: Array<{ type: string }> = [];
    const storage = {
      saveMission: async (state: MissionState) => { saved.push(state); },
      appendEvent: async (_taskId: string, event: { type: string }) => { events.push(event); },
      flushMission: async () => {},
    } as unknown as MissionStateStorage;

    await expect(service.runMission(
      { id: 'm-synthesis-error', prompt: 'x', agents: ['a'] },
      { execute: async () => 'specialist result' },
      { synthesize: async () => { throw new Error('Synthese nicht erreichbar'); } },
      undefined,
      undefined,
      { storage },
    )).rejects.toThrow('Synthese nicht erreichbar');

    expect(saved.at(-1)).toMatchObject({
      status: 'error',
      overall: 80,
      synthesis: { status: 'error', error: 'Synthese nicht erreichbar' },
    });
    expect(saved.at(-1)?.completedAt).toBeUndefined();
    expect(events.some((event) => event.type === 'completed')).toBe(false);
    expect(events.at(-1)?.type).toBe('error');
    expect(service.isMissionActive('m-synthesis-error')).toBe(false);
  });

  it('runMission does not resolve before the final persistence flush finishes', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    let releaseFlush: (() => void) | undefined;
    let signalFlushStarted: (() => void) | undefined;
    const flushStarted = new Promise<void>((resolve) => { signalFlushStarted = resolve; });
    const storage = {
      saveMission: async () => {},
      appendEvent: async () => {},
      flushMission: async () => {
        signalFlushStarted?.();
        await new Promise<void>((resolve) => { releaseFlush = resolve; });
      },
    } as unknown as MissionStateStorage;

    const run = service.runMission(
      { id: 'm-flush', prompt: 'x', agents: ['a'] },
      { execute: async () => 'result' },
      undefined,
      undefined,
      undefined,
      { storage },
    );
    let settled = false;
    void run.then(() => { settled = true; });

    await flushStarted;
    expect(settled).toBe(false);
    releaseFlush?.();
    await run;
    expect(settled).toBe(true);
  });

  it('does not resume a mission that is still active in this process', async () => {
    const service = new MultiAgentService();
    service.registerAgent({ id: 'a', name: 'A', role: 'a', systemPrompt: 'A' });

    let releaseAgent: (() => void) | undefined;
    let signalAgentStarted: (() => void) | undefined;
    const agentStarted = new Promise<void>((resolve) => { signalAgentStarted = resolve; });
    const running = service.runMission(
      { id: 'm-active', prompt: 'x', agents: ['a'] },
      {
        execute: async () => {
          signalAgentStarted?.();
          await new Promise<void>((resolve) => { releaseAgent = resolve; });
          return 'done';
        },
      },
    );
    await agentStarted;

    expect(service.isMissionActive('m-active')).toBe(true);
    await expect(service.resumeMission(
      {
        taskId: 'm-active',
        prompt: 'x',
        agentIds: ['a'],
        status: 'running',
        overall: 10,
        agents: [{ agentId: 'a', status: 'running', progress: 10 }],
        createdAt: 1,
        updatedAt: 2,
      },
      { execute: async () => 'duplicate' },
    )).rejects.toThrow('already active');

    releaseAgent?.();
    await running;
    expect(service.isMissionActive('m-active')).toBe(false);
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
      completedAt: 2,
    };

    const executed: string[] = [];
    const resumedStates: MissionState[] = [];
    const storage = {
      saveMission: async (mission: MissionState) => { resumedStates.push(mission); },
      appendEvent: async () => {},
      flushMission: async () => {},
    } as unknown as MissionStateStorage;
    let clock = 10;
    const outcome = await service.resumeMission(
      state,
      { execute: async (agent) => { executed.push(agent.id); return `rerun-${agent.id}`; } },
      undefined,
      undefined,
      () => (clock += 1),
      { storage },
    );

    expect(executed).toEqual(['b']);
    expect(outcome.results.find((r) => r.agentId === 'a')?.output).toBe('kept-a');
    expect(outcome.results.find((r) => r.agentId === 'b')?.output).toBe('rerun-b');
    expect(resumedStates.find((mission) => mission.status === 'running')?.completedAt).toBeUndefined();
    expect(resumedStates.at(-1)?.completedAt).toBeGreaterThan(2);
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
