import {
  ModelConfigSyncRegistry,
  syncProviderModelConfig,
} from '@/core/providers/modelConfigSync';

describe('ModelConfigSyncRegistry', () => {
  beforeEach(() => {
    ModelConfigSyncRegistry.clear();
  });

  it('returns false when no syncer is registered', () => {
    const result = syncProviderModelConfig('unknown', 'model-id', {});
    expect(result).toBe(false);
  });

  it('delegates to the registered syncer and returns its result', () => {
    const syncer = { syncModelConfig: jest.fn().mockReturnValue(true) };
    ModelConfigSyncRegistry.register('kimi', syncer);

    const result = syncProviderModelConfig('kimi', 'kimi-k2', { providerConfigs: {} });

    expect(result).toBe(true);
    expect(syncer.syncModelConfig).toHaveBeenCalledWith('kimi-k2', { providerConfigs: {} });
  });

  it('isolates providers from each other', () => {
    const kimiSyncer = { syncModelConfig: jest.fn().mockReturnValue(true) };
    ModelConfigSyncRegistry.register('kimi', kimiSyncer);

    expect(syncProviderModelConfig('vibe', 'vibe-k2', {})).toBe(false);
    expect(kimiSyncer.syncModelConfig).not.toHaveBeenCalled();
  });
});
