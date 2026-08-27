import { VibeAuxQueryRunner } from '@/providers/vibe/runtime/VibeAuxQueryRunner';
import { buildVibeLaunchSpec } from '@/providers/vibe/runtime/VibeLaunchSpec';

jest.mock('@/providers/vibe/runtime/VibeLaunchSpec', () => ({
  buildVibeLaunchSpec: jest.fn(() => { throw new Error('launch captured'); }),
}));

describe('VibeAuxQueryRunner safety', () => {
  it('uses the plan agent without workspace trust or yolo for hidden verifier queries', async () => {
    const runner = new VibeAuxQueryRunner({
      app: { vault: { adapter: { basePath: '/vault' } } },
      settings: { providerConfigs: { vibe: { enabled: true } } },
      getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/vibe'),
      getActiveEnvironmentVariables: jest.fn().mockReturnValue(''),
    } as never);

    await expect(runner.query({ systemPrompt: 'Verifier' }, 'Prüfe das Ziel'))
      .rejects.toThrow('launch captured');

    expect(buildVibeLaunchSpec).toHaveBeenCalledWith(expect.objectContaining({
      permissionMode: 'plan',
      trustWorkspace: false,
    }));
  });
});
