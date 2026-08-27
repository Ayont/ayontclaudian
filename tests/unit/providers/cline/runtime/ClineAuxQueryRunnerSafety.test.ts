import { ClineAuxQueryRunner } from '@/providers/cline/runtime/ClineAuxQueryRunner';
import { buildClineLaunchSpec } from '@/providers/cline/runtime/ClineLaunchSpec';
import { spawnClineProcess } from '@/providers/cline/runtime/ClineProcess';

jest.mock('@/providers/cline/runtime/ClineLaunchSpec', () => ({
  buildClineLaunchSpec: jest.fn().mockReturnValue({ args: [], command: '/bin/cline' }),
}));
jest.mock('@/providers/cline/runtime/ClineProcess', () => ({
  spawnClineProcess: jest.fn(() => { throw new Error('spawn stopped'); }),
}));

describe('ClineAuxQueryRunner safety', () => {
  it('starts hidden verifier queries in plan mode without auto-approval', async () => {
    const runner = new ClineAuxQueryRunner({
      app: { vault: { adapter: { basePath: '/vault' } } },
      settings: { providerConfigs: { cline: { enabled: true } } },
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/cline'),
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    } as never);

    await expect(runner.query({ systemPrompt: 'Verifier' }, 'Prüfe das Ziel'))
      .rejects.toThrow('spawn stopped');

    expect(buildClineLaunchSpec).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'plan',
    }));
    expect(spawnClineProcess).toHaveBeenCalledTimes(1);
  });
});
