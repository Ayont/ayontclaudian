import { estimateTokens, MultiAgentService } from '../../../../../src/core/intelligence/multiAgent/MultiAgentService';

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
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});
