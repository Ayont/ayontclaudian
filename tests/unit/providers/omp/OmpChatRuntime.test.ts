import { attachPlanTestTurn, planNotification, todoToolUses } from '@test/helpers/acpPlanTurn';

import { parseTodoInput } from '@/core/tools/todo';
import { OmpChatRuntime } from '@/providers/omp/runtime/OmpChatRuntime';

function createMockPlugin(): any {
  return {
    app: { vault: { adapter: { basePath: '/tmp/claudian-test-vault' } } },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/omp'),
    manifest: { version: '0.0.0-test' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings: { providerConfigs: { omp: { enabled: true } } },
  };
}

describe('OmpChatRuntime ACP plan updates', () => {
  it('shows repeated plan updates as one TodoWrite card', async () => {
    const runtime = new OmpChatRuntime(createMockPlugin());
    const turn = attachPlanTestTurn(runtime);

    await (runtime as any).handleSessionNotification(planNotification([{ content: 'Recon', status: 'in_progress' }]));
    await (runtime as any).handleSessionNotification(planNotification([{ content: 'Recon', status: 'completed' }]));

    const uses = todoToolUses(turn.chunks());
    expect(uses).toHaveLength(2);
    expect(uses[1].id).toBe(uses[0].id);
    expect(parseTodoInput(uses[1].input)?.[0].status).toBe('completed');
  });
});
