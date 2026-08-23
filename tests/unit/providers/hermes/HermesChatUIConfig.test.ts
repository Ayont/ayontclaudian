import { updateHermesDiscoveryState } from '@/providers/hermes/discoveryState';
import { hermesChatUIConfig } from '@/providers/hermes/ui/HermesChatUIConfig';

const OPUS = 'openrouter:anthropic/claude-opus-5';
const SONNET = 'openrouter:anthropic/claude-sonnet-5';

function createSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
  const settings: Record<string, unknown> = { providerConfigs: { hermes: config } };
  updateHermesDiscoveryState(settings, {
    availableModes: [
      { description: 'Ask before edits.', id: 'default', name: 'Default' },
      { description: 'Auto-allow workspace edits.', id: 'accept_edits', name: 'Accept Edits' },
      { description: 'Auto-allow file edits.', id: 'dont_ask', name: "Don't Ask" },
    ],
    discoveredModels: [
      { description: 'Provider: OpenRouter', label: 'OpenRouter · anthropic/claude-opus-5', rawId: OPUS },
      { description: 'Provider: OpenRouter', label: 'OpenRouter · anthropic/claude-sonnet-5', rawId: SONNET },
    ],
  });
  return settings;
}

describe('hermesChatUIConfig.getModelOptions', () => {
  it('lists the visible models with their discovered labels', () => {
    const settings = createSettings({ visibleModels: [OPUS] });

    expect(hermesChatUIConfig.getModelOptions(settings)).toEqual([
      {
        description: 'Provider: OpenRouter',
        label: 'OpenRouter · anthropic/claude-opus-5',
        value: `hermes:${OPUS}`,
      },
    ]);
  });

  it('prefers a user alias over the discovered label', () => {
    const settings = createSettings({ modelAliases: { [OPUS]: 'Opus' }, visibleModels: [OPUS] });

    expect(hermesChatUIConfig.getModelOptions(settings)[0].label).toBe('Opus');
  });

  it('keeps a hidden model selectable while a session still uses it', () => {
    const settings = createSettings({ visibleModels: [OPUS] });
    settings.model = `hermes:${SONNET}`;

    expect(hermesChatUIConfig.getModelOptions(settings).map((option) => option.value)).toEqual([
      `hermes:${OPUS}`,
      `hermes:${SONNET}`,
    ]);
  });

  it('shows a placeholder until the catalog has been discovered', () => {
    const settings: Record<string, unknown> = { providerConfigs: { hermes: {} } };

    expect(hermesChatUIConfig.getModelOptions(settings)).toEqual([
      { value: 'hermes', label: 'Hermes', description: 'Modelle werden beim ersten Start geladen' },
    ]);
  });

  it('claims only its own model ids', () => {
    expect(hermesChatUIConfig.ownsModel(`hermes:${OPUS}`, {})).toBe(true);
    expect(hermesChatUIConfig.ownsModel('opencode:anthropic/claude-opus-5', {})).toBe(false);
  });
});

describe('hermesChatUIConfig reasoning', () => {
  it('offers no reasoning control because Hermes exposes none over ACP', () => {
    const settings = createSettings({});

    expect(hermesChatUIConfig.isAdaptiveReasoningModel(`hermes:${OPUS}`, settings)).toBe(false);
    expect(hermesChatUIConfig.getReasoningOptions(`hermes:${OPUS}`, settings)).toEqual([]);
    expect(hermesChatUIConfig.getDefaultReasoningValue(`hermes:${OPUS}`, settings)).toBe('');
  });
});

describe('hermesChatUIConfig modes', () => {
  it('offers the three modes the ACP server accepts', () => {
    const settings = createSettings({ selectedMode: 'accept_edits' });

    const selector = hermesChatUIConfig.getModeSelector?.(settings);
    expect(selector?.options.map((option) => option.value)).toEqual([
      'default',
      'accept_edits',
      'dont_ask',
    ]);
    expect(selector?.value).toBe('accept_edits');
  });

  it('offers no Safe/YOLO/Plan toggle, since Hermes has no plan mode', () => {
    expect(hermesChatUIConfig.getPermissionModeToggle?.()).toBeNull();
  });

  it('persists a mode change and mirrors it onto the shared permission mode', () => {
    const settings = createSettings({});

    hermesChatUIConfig.applyModeSelection?.('dont_ask', settings);

    expect(hermesChatUIConfig.getModeSelector?.(settings)?.value).toBe('dont_ask');
    expect(settings.permissionMode).toBe('yolo');
    expect(hermesChatUIConfig.resolvePermissionMode?.(settings)).toBe('yolo');
  });

  it('rejects a mode Hermes does not implement', () => {
    const settings = createSettings({});

    hermesChatUIConfig.applyModeSelection?.('plan', settings);

    expect(hermesChatUIConfig.getModeSelector?.(settings)?.value).toBe('default');
    expect(settings.permissionMode).toBe('normal');
  });
});

describe('hermesChatUIConfig.applyModelDefaults', () => {
  it('stores the canonical selection id', () => {
    const settings = createSettings({});

    hermesChatUIConfig.applyModelDefaults(`hermes:${OPUS}`, settings);

    expect(settings.model).toBe(`hermes:${OPUS}`);
  });

  it('ignores a selection owned by another provider', () => {
    const settings = createSettings({});

    hermesChatUIConfig.applyModelDefaults('opencode:x', settings);

    expect(settings.model).toBeUndefined();
  });
});
