import { applyClaudeDynamicUpdates, type ClaudeDynamicUpdateDeps } from '@/providers/claude/runtime/ClaudeDynamicUpdates';
import type { PersistentQueryConfig } from '@/providers/claude/runtime/types';

function createConfig(overrides: Partial<PersistentQueryConfig> = {}): PersistentQueryConfig {
  return {
    model: 'opus',
    effortLevel: 'high',
    permissionMode: 'yolo',
    sdkPermissionMode: 'bypassPermissions',
    systemPromptKey: 'key',
    disallowedToolsKey: '',
    mcpServersKey: '{}',
    pluginsKey: '',
    externalContextPaths: [],
    settingSources: 'project,local',
    claudeCliPath: '/mock/claude',
    enableChrome: false,
    enableAutoMode: false,
    fastMode: false,
    ...overrides,
  };
}

function createDeps(overrides: {
  config?: PersistentQueryConfig;
  applyFlagSettings?: jest.Mock;
  settings?: { model: string; effortLevel: string; serviceTier: string };
} = {}): { deps: ClaudeDynamicUpdateDeps; applyFlagSettings: jest.Mock; config: PersistentQueryConfig } {
  const config = createConfig(overrides.config);
  const applyFlagSettings = overrides.applyFlagSettings ?? jest.fn().mockResolvedValue(undefined);
  const settings = overrides.settings ?? { model: 'opus', effortLevel: 'high', serviceTier: 'fast' };

  const deps: ClaudeDynamicUpdateDeps = {
    getPersistentQuery: () => ({ applyFlagSettings, setModel: jest.fn(), setPermissionMode: jest.fn(), setMcpServers: jest.fn() } as never),
    getCurrentConfig: () => config,
    mutateCurrentConfig: (mutate) => {
      mutate(config);
    },
    getVaultPath: () => '/vault',
    getCliPath: () => '/mock/claude',
    getScopedSettings: () => settings as never,
    getPermissionMode: () => 'yolo',
    resolveSDKPermissionMode: () => 'bypassPermissions',
    mcpManager: {
      getActiveServers: () => ({}),
    } as never,
    buildPersistentQueryConfig: () => config,
    needsRestart: () => false,
    ensureReady: jest.fn().mockResolvedValue(true),
    setCurrentExternalContextPaths: jest.fn(),
    notifyFailure: jest.fn(),
  };

  return { deps, applyFlagSettings, config };
}

describe('applyClaudeDynamicUpdates fast mode', () => {
  it('turns Claude fast mode on via applyFlagSettings without restarting', async () => {
    const { deps, applyFlagSettings } = createDeps();

    await applyClaudeDynamicUpdates(deps);

    expect(applyFlagSettings).toHaveBeenCalledWith(expect.objectContaining({ fastMode: true }));
  });

  it('turns Claude fast mode off when Speed is disabled or the model cannot serve it', async () => {
    const onHaiku = createDeps({
      config: createConfig({ model: 'haiku', fastMode: true }),
      settings: { model: 'haiku', effortLevel: 'high', serviceTier: 'fast' },
    });
    await applyClaudeDynamicUpdates(onHaiku.deps);
    expect(onHaiku.applyFlagSettings).toHaveBeenCalledWith(expect.objectContaining({ fastMode: false }));

    const offOpus = createDeps({
      config: createConfig({ fastMode: true }),
      settings: { model: 'opus', effortLevel: 'high', serviceTier: 'default' },
    });
    await applyClaudeDynamicUpdates(offOpus.deps);
    expect(offOpus.applyFlagSettings).toHaveBeenCalledWith(expect.objectContaining({ fastMode: false }));
  });

  it('does not re-send fast mode when the live session already matches', async () => {
    const { deps, applyFlagSettings } = createDeps({
      config: createConfig({ fastMode: true }),
    });

    await applyClaudeDynamicUpdates(deps);

    expect(applyFlagSettings).not.toHaveBeenCalledWith(expect.objectContaining({ fastMode: true }));
  });
});
