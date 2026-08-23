const mockGetHostnameKey = jest.fn(() => 'host-a');
const mockGetLegacyHostnameKey = jest.fn(() => 'legacy-host');

jest.mock('../../../../src/utils/env', () => ({
  ...jest.requireActual('../../../../src/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
  getLegacyHostnameKey: () => mockGetLegacyHostnameKey(),
}));

import { updateHermesDiscoveryState } from '../../../../src/providers/hermes/discoveryState';
import {
  DEFAULT_HERMES_PROVIDER_SETTINGS,
  getHermesProviderSettings,
  normalizeHermesModelAliases,
  normalizeHermesVisibleModels,
  updateHermesProviderSettings,
} from '../../../../src/providers/hermes/settings';

const OPUS = 'openrouter:anthropic/claude-opus-5';
const SONNET = 'openrouter:anthropic/claude-sonnet-5';

function createSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
  return { providerConfigs: { hermes: config } };
}

describe('Hermes provider settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('host-a');
    mockGetLegacyHostnameKey.mockReturnValue('legacy-host');
  });

  it('ships disabled with the vault prompt on and every escape hatch off', () => {
    expect(DEFAULT_HERMES_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_HERMES_PROVIDER_SETTINGS.injectVaultPrompt).toBe(true);
    expect(DEFAULT_HERMES_PROVIDER_SETTINGS.acceptHooks).toBe(false);
    expect(DEFAULT_HERMES_PROVIDER_SETTINGS.yoloMode).toBe(false);
    expect(DEFAULT_HERMES_PROVIDER_SETTINGS.selectedMode).toBe('default');
  });

  it('reads persisted values back', () => {
    const settings = createSettings({
      acceptHooks: true,
      enabled: true,
      injectVaultPrompt: false,
      selectedMode: 'dont_ask',
      visibleModels: [OPUS],
      yoloMode: true,
    });

    expect(getHermesProviderSettings(settings)).toMatchObject({
      acceptHooks: true,
      enabled: true,
      injectVaultPrompt: false,
      selectedMode: 'dont_ask',
      visibleModels: [OPUS],
      yoloMode: true,
    });
  });

  it('coerces a mode the running Hermes does not offer back to default', () => {
    const settings = createSettings({ selectedMode: 'plan' });

    expect(getHermesProviderSettings(settings).selectedMode).toBe('default');
  });

  it('keeps the discovered catalog out of the persisted config', () => {
    const settings = createSettings({});
    updateHermesDiscoveryState(settings, {
      discoveredModels: [{ label: 'OpenRouter · opus', rawId: OPUS }],
    });

    updateHermesProviderSettings(settings, { enabled: true });

    const persisted = (settings.providerConfigs as Record<string, Record<string, unknown>>).hermes;
    expect(persisted).not.toHaveProperty('discoveredModels');
    expect(persisted).not.toHaveProperty('availableModes');
    expect(getHermesProviderSettings(settings).discoveredModels).toHaveLength(1);
  });

  it('writes the CLI path into the per-host map', () => {
    const settings = createSettings({});

    updateHermesProviderSettings(settings, { cliPath: ' /usr/local/bin/hermes ' });

    expect(getHermesProviderSettings(settings).cliPathsByHost).toEqual({
      'host-a': '/usr/local/bin/hermes',
    });
    expect(getHermesProviderSettings(settings).cliPath).toBe('');
  });
});

describe('normalizeHermesVisibleModels', () => {
  it('trims, deduplicates and preserves order', () => {
    expect(normalizeHermesVisibleModels([` ${OPUS} `, OPUS, SONNET, '', 42]))
      .toEqual([OPUS, SONNET]);
  });

  it('returns an empty list for non-array input', () => {
    expect(normalizeHermesVisibleModels('nope')).toEqual([]);
  });
});

describe('normalizeHermesModelAliases', () => {
  it('drops blank keys and values', () => {
    expect(normalizeHermesModelAliases({ [OPUS]: ' Opus ', [SONNET]: '  ', '  ': 'x' }))
      .toEqual({ [OPUS]: 'Opus' });
  });
});

describe('hiding a model that is still selected', () => {
  it('prunes its alias and retargets every selection to the first visible model', () => {
    const settings: Record<string, unknown> = {
      model: `hermes:${SONNET}`,
      providerConfigs: {
        hermes: { modelAliases: { [SONNET]: 'Sonnet' }, visibleModels: [OPUS, SONNET] },
      },
      savedProviderModel: { hermes: `hermes:${SONNET}` },
      titleGenerationModel: `hermes:${SONNET}`,
    };

    updateHermesProviderSettings(settings, { visibleModels: [OPUS] });

    expect(settings.model).toBe(`hermes:${OPUS}`);
    expect((settings.savedProviderModel as Record<string, string>).hermes).toBe(`hermes:${OPUS}`);
    expect(settings.titleGenerationModel).toBe(`hermes:${OPUS}`);
    expect(getHermesProviderSettings(settings).modelAliases).toEqual({});
  });

  it('clears the title model when nothing stays visible', () => {
    const settings: Record<string, unknown> = {
      providerConfigs: { hermes: { visibleModels: [OPUS] } },
      titleGenerationModel: `hermes:${OPUS}`,
    };

    updateHermesProviderSettings(settings, { visibleModels: [] });

    expect(settings.titleGenerationModel).toBe('');
  });

  it('leaves another provider\'s selection alone', () => {
    const settings: Record<string, unknown> = {
      model: 'opencode:anthropic/claude-opus-5',
      providerConfigs: { hermes: { visibleModels: [OPUS, SONNET] } },
    };

    updateHermesProviderSettings(settings, { visibleModels: [OPUS] });

    expect(settings.model).toBe('opencode:anthropic/claude-opus-5');
  });
});
