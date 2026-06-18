import {
  DEFAULT_KIMI_PROVIDER_SETTINGS,
  getKimiProviderSettings,
  updateKimiProviderSettings,
} from '@/providers/kimi/settings';

describe('Kimi provider settings', () => {
  it('defaults apiKey to empty string', () => {
    expect(DEFAULT_KIMI_PROVIDER_SETTINGS.apiKey).toBe('');
  });

  it('round-trips apiKey from persisted config', () => {
    const settings: Record<string, unknown> = {};
    updateKimiProviderSettings(settings, { apiKey: 'sk-test' });
    const result = getKimiProviderSettings(settings);
    expect(result.apiKey).toBe('sk-test');
  });

  it('preserves apiKey when updating unrelated fields', () => {
    const settings: Record<string, unknown> = {};
    updateKimiProviderSettings(settings, { apiKey: 'sk-test' });
    updateKimiProviderSettings(settings, { thinkingDefault: false });
    const result = getKimiProviderSettings(settings);
    expect(result.apiKey).toBe('sk-test');
    expect(result.thinkingDefault).toBe(false);
  });

  it('clears apiKey when set to empty string', () => {
    const settings: Record<string, unknown> = {};
    updateKimiProviderSettings(settings, { apiKey: 'sk-test' });
    updateKimiProviderSettings(settings, { apiKey: '' });
    const result = getKimiProviderSettings(settings);
    expect(result.apiKey).toBe('');
  });

  it('defaults useAcp to false', () => {
    const settings: Record<string, unknown> = {};
    const result = getKimiProviderSettings(settings);
    expect(result.useAcp).toBe(false);
  });

  it('round-trips useAcp', () => {
    const settings: Record<string, unknown> = {};
    updateKimiProviderSettings(settings, { useAcp: true });
    const result = getKimiProviderSettings(settings);
    expect(result.useAcp).toBe(true);
  });
});
