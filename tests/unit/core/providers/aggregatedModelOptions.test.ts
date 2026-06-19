import '@/providers';

import { getEnabledProviderForModel, getProviderForModel } from '@/core/providers/modelRouting';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

describe('ProviderRegistry.getAggregatedModelOptions (unified model dropdown)', () => {
  it('prepends the Auto model option before provider models', () => {
    const settings = { providerConfigs: { codex: { enabled: false } } };
    const aggregated = ProviderRegistry.getAggregatedModelOptions(settings);
    const first = aggregated[0];

    expect(first.value).toBe('__auto__');
    expect(first.label).toBe('Auto');
    expect(first.group).toBe('Auto-Router');
  });

  it('returns provider options alongside the Auto option when one provider is enabled', () => {
    const settings = { providerConfigs: { codex: { enabled: false } } };

    const aggregated = ProviderRegistry.getAggregatedModelOptions(settings);
    const claudeOnly = ProviderRegistry.getChatUIConfig('claude').getModelOptions(settings);

    // Auto option is present in addition to all Claude models.
    const values = aggregated.map(o => o.value);
    expect(values[0]).toBe('__auto__');
    expect(new Set(values)).toEqual(new Set(['__auto__', ...claudeOnly.map(o => o.value)]));
  });

  it('aggregates options across all enabled providers, tagging group + icon', () => {
    const settings = { providerConfigs: { codex: { enabled: true } } };

    const aggregated = ProviderRegistry.getAggregatedModelOptions(settings);
    const groups = new Set(aggregated.map(o => o.group));

    expect(groups.has('Auto-Router')).toBe(true);
    expect(groups.has(ProviderRegistry.getProviderDisplayName('claude'))).toBe(true);
    expect(groups.has(ProviderRegistry.getProviderDisplayName('codex'))).toBe(true);

    // Codex's primary model is present and tagged with the Codex group + icon.
    const codexOption = aggregated.find(o => o.value === DEFAULT_CODEX_PRIMARY_MODEL);
    expect(codexOption).toBeDefined();
    expect(codexOption?.group).toBe(ProviderRegistry.getProviderDisplayName('codex'));

    // The tagged icon matches the owning provider's icon (undefined when none).
    const codexIcon = ProviderRegistry.getChatUIConfig('codex').getProviderIcon?.() ?? undefined;
    expect(codexOption?.providerIcon).toEqual(codexIcon);
  });

  it('shows Auto-Router group first, then orders provider groups by enabled-provider order', () => {
    const settings = { providerConfigs: { codex: { enabled: true } } };

    const aggregated = ProviderRegistry.getAggregatedModelOptions(settings);
    const enabledOrder = ProviderRegistry.getEnabledProviderIds(settings)
      .map(id => ProviderRegistry.getProviderDisplayName(id));

    // Group labels appear in the same relative order as the enabled providers,
    // preceded by the Auto-Router group.
    const seenGroups: string[] = [];
    for (const opt of aggregated) {
      if (opt.group && seenGroups[seenGroups.length - 1] !== opt.group) {
        seenGroups.push(opt.group);
      }
    }
    expect(seenGroups[0]).toBe('Auto-Router');
    expect(seenGroups.slice(1)).toEqual(enabledOrder.filter(g => g !== 'Auto-Router'));
  });
});

describe('resolveProviderForModel for the unified dropdown', () => {
  it('routes each provider\'s model to its owning provider', () => {
    expect(getProviderForModel('sonnet')).toBe('claude');
    expect(getProviderForModel('opus')).toBe('claude');
    expect(getProviderForModel(DEFAULT_CODEX_PRIMARY_MODEL)).toBe('codex');
    expect(getProviderForModel('gpt-4o')).toBe('codex');
  });

  it('resolves a model from another provider when both are enabled', () => {
    const settings = { providerConfigs: { codex: { enabled: true } } };

    // From a Claude conversation, picking the Codex model resolves to codex.
    expect(getEnabledProviderForModel(DEFAULT_CODEX_PRIMARY_MODEL, settings)).toBe('codex');
    // And a Claude model still resolves to claude.
    expect(getEnabledProviderForModel('sonnet', settings)).toBe('claude');
  });

  it('every aggregated option resolves to a provider that owns it (skipping the Auto sentinel)', () => {
    const settings = { providerConfigs: { codex: { enabled: true } } };
    const aggregated = ProviderRegistry.getAggregatedModelOptions(settings);

    for (const option of aggregated) {
      // __auto__ is a virtual option that does not belong to any provider.
      if (option.value === '__auto__') continue;
      const owner = getEnabledProviderForModel(option.value, settings);
      expect(ProviderRegistry.getChatUIConfig(owner).ownsModel(option.value, settings)).toBe(true);
    }
  });
});
