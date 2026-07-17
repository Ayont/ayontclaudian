import {
  getProviderConfig,
  setProviderConfig,
  setProviderEnabled,
} from '../../../../src/core/providers/providerConfig';
import { ProviderRegistry } from '../../../../src/core/providers/ProviderRegistry';
import { registerBuiltInProviders } from '../../../../src/providers';

describe('providerConfig', () => {
  describe('setProviderEnabled', () => {
    it('enables a provider that has no prior config', () => {
      const settings: Record<string, unknown> = {};

      setProviderEnabled(settings, 'kimi', true);

      expect(getProviderConfig(settings, 'kimi').enabled).toBe(true);
    });

    it('disables a provider without touching its other config fields', () => {
      const settings: Record<string, unknown> = {};
      setProviderConfig(settings, 'grok', {
        cliPath: '/usr/local/bin/grok',
        customModels: 'grok-4',
        enabled: true,
      });

      setProviderEnabled(settings, 'grok', false);

      const config = getProviderConfig(settings, 'grok');
      expect(config.enabled).toBe(false);
      expect(config.cliPath).toBe('/usr/local/bin/grok');
      expect(config.customModels).toBe('grok-4');
    });

    it('does not mutate other providers', () => {
      const settings: Record<string, unknown> = {};
      setProviderEnabled(settings, 'kimi', true);

      setProviderEnabled(settings, 'vibe', true);

      expect(getProviderConfig(settings, 'kimi').enabled).toBe(true);
      expect(getProviderConfig(settings, 'vibe').enabled).toBe(true);
    });
  });

  describe('central enable flow (General tab providers section)', () => {
    beforeAll(() => {
      registerBuiltInProviders();
    });

    it.each(['codex', 'opencode', 'pi', 'antigravity', 'kimi', 'vibe', 'grok'] as const)(
      'setProviderEnabled(%s) flips ProviderRegistry.isEnabled',
      (providerId) => {
        const settings: Record<string, unknown> = {};

        expect(ProviderRegistry.isEnabled(providerId, settings)).toBe(false);

        setProviderEnabled(settings, providerId, true);
        expect(ProviderRegistry.isEnabled(providerId, settings)).toBe(true);

        setProviderEnabled(settings, providerId, false);
        expect(ProviderRegistry.isEnabled(providerId, settings)).toBe(false);
      },
    );

    it('claude stays enabled even with an explicit enabled:false config (always-on probe)', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: { claude: { enabled: false } },
      };

      expect(ProviderRegistry.isEnabled('claude', settings)).toBe(true);
    });
  });
});
