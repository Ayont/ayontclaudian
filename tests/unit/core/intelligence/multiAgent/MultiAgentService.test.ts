import { MultiAgentService } from '../../../../../src/core/intelligence/multiAgent/MultiAgentService';

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
});
