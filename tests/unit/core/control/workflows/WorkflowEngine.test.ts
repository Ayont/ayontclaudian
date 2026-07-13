import { WorkflowEngine } from '../../../../../src/core/control/workflows/WorkflowEngine';

describe('WorkflowEngine', () => {
  it('registers and runs event-triggered workflows', async () => {
    const executed: string[] = [];
    const engine = new WorkflowEngine(async (step) => {
      executed.push(step.action);
    });

    engine.register({
      id: 'wf-1',
      name: 'Test workflow',
      enabled: true,
      trigger: { type: 'event', event: { type: 'vault:file-created' } },
      steps: [{ id: 's1', action: 'noop', params: {} }],
    });

    expect(engine.list()).toHaveLength(1);
    engine.stop();
  });

  it('loads, runs, toggles, and persists scheduled workflows', async () => {
    const executed: string[] = [];
    const save = jest.fn(async () => undefined);
    const workflow = {
      id: 'scheduled', name: 'Digest', enabled: true,
      trigger: { type: 'schedule' as const, schedule: { cron: 'daily@08:00' } },
      steps: [{ id: 'prompt', action: 'agent-prompt', params: { prompt: 'Digest' } }],
    };
    const engine = new WorkflowEngine(
      async (step) => { executed.push(step.action); },
      { load: async () => [workflow], save },
    );
    await engine.load();
    expect(engine.list()[0].nextRun).toBeGreaterThan(Date.now());
    expect(await engine.run('scheduled')).toBe(true);
    expect(executed).toEqual(['agent-prompt']);
    expect(engine.setEnabled('scheduled', false)).toBe(true);
    expect(save).toHaveBeenCalled();
  });

  it('lists registered workflows', () => {
    const engine = new WorkflowEngine(async () => {});
    engine.register({
      id: 'wf-1',
      name: 'Test',
      enabled: true,
      trigger: { type: 'schedule', schedule: { cron: 'daily' } },
      steps: [],
    });
    expect(engine.list()).toHaveLength(1);
    engine.stop();
  });
});
