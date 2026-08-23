import {
  clearHermesDiscoveryState,
  getHermesDiscoveryState,
  updateHermesDiscoveryState,
} from '@/providers/hermes/discoveryState';

const OPUS = 'openrouter:anthropic/claude-opus-5';

describe('Hermes discovery state', () => {
  it('starts empty and reports a real change once', () => {
    const settings: Record<string, unknown> = {};

    expect(getHermesDiscoveryState(settings)).toEqual({
      availableModes: [],
      discoveredModels: [],
    });
    expect(updateHermesDiscoveryState(settings, {
      discoveredModels: [{ label: 'Opus', rawId: OPUS }],
    })).toBe(true);
    expect(updateHermesDiscoveryState(settings, {
      discoveredModels: [{ label: 'Opus', rawId: OPUS }],
    })).toBe(false);
  });

  it('hands out copies so callers cannot mutate the cache', () => {
    const settings: Record<string, unknown> = {};
    updateHermesDiscoveryState(settings, { discoveredModels: [{ label: 'Opus', rawId: OPUS }] });

    getHermesDiscoveryState(settings).discoveredModels[0].label = 'tampered';

    expect(getHermesDiscoveryState(settings).discoveredModels[0].label).toBe('Opus');
  });

  it('keeps untouched collections when only one is updated', () => {
    const settings: Record<string, unknown> = {};
    updateHermesDiscoveryState(settings, {
      availableModes: [{ id: 'default', name: 'Default' }],
      discoveredModels: [{ label: 'Opus', rawId: OPUS }],
    });

    updateHermesDiscoveryState(settings, { discoveredModels: [] });

    expect(getHermesDiscoveryState(settings).availableModes).toHaveLength(1);
    expect(getHermesDiscoveryState(settings).discoveredModels).toHaveLength(0);
  });

  it('clears only when something was cached', () => {
    const settings: Record<string, unknown> = {};
    expect(clearHermesDiscoveryState(settings)).toBe(false);

    updateHermesDiscoveryState(settings, { discoveredModels: [{ label: 'Opus', rawId: OPUS }] });

    expect(clearHermesDiscoveryState(settings)).toBe(true);
    expect(getHermesDiscoveryState(settings).discoveredModels).toEqual([]);
  });

  it('is not serialized with the settings object', () => {
    const settings: Record<string, unknown> = { model: 'hermes' };
    updateHermesDiscoveryState(settings, { discoveredModels: [{ label: 'Opus', rawId: OPUS }] });

    expect(JSON.parse(JSON.stringify(settings))).toEqual({ model: 'hermes' });
  });
});
