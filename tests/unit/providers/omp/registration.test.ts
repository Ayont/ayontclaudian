import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';
import { ompProviderRegistration } from '@/providers/omp/registration';
import { DEFAULT_OMP_PROVIDER_SETTINGS, updateOmpProviderSettings } from '@/providers/omp/settings';
import { ompChatUIConfig } from '@/providers/omp/ui/OmpChatUIConfig';

describe('ompProviderRegistration', () => {
  it('ships disabled so an uninstalled CLI never appears as a broken provider', () => {
    expect(DEFAULT_OMP_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(ompProviderRegistration.isEnabled({ providerConfigs: {} })).toBe(false);
  });

  it('reads its enabled flag from provider config', () => {
    expect(ompProviderRegistration.isEnabled({
      providerConfigs: { omp: { ...DEFAULT_OMP_PROVIDER_SETTINGS, enabled: true } },
    })).toBe(true);
  });

  it('uses a display name distinct from the older pi provider', () => {
    expect(ompProviderRegistration.displayName).toBe('OMP');
  });

  it('claims only OMP_ environment variables, leaving PI_ to the pi provider', () => {
    const patterns = ompProviderRegistration.environmentKeyPatterns ?? [];
    expect(patterns.some((pattern) => pattern.test('OMP_PROFILE'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('PI_SMOL_MODEL'))).toBe(false);
  });

  it('provides an auxiliary runner so hidden calls stay session-isolated', () => {
    expect(typeof ompProviderRegistration.createAuxQueryRunner).toBe('function');
  });

  it('is part of the built-in default provider configs', () => {
    const configs = getBuiltInProviderDefaultConfigs();
    expect(configs).toHaveProperty('omp');
    expect(configs.omp).not.toBe(getBuiltInProviderDefaultConfigs().omp);
  });

  it('offers user-typed custom model ids in the picker', () => {
    const bag: Record<string, unknown> = {};
    updateOmpProviderSettings(bag, { customModels: 'acme/my-omp-model' });
    const options = ompChatUIConfig.getModelOptions(bag);
    expect(options.some((option) => option.label === 'acme/my-omp-model' || option.value.includes('my-omp-model'))).toBe(true);
  });
});
