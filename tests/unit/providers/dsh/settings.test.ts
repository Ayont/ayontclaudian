import {
  DEFAULT_DSH_PROVIDER_SETTINGS,
  getDshProviderSettings,
  updateDshProviderSettings,
} from '@/providers/dsh/settings';

describe('dsh provider settings', () => {
  it('ships disabled by default', () => {
    expect(DEFAULT_DSH_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(getDshProviderSettings({}).enabled).toBe(false);
  });

  it('normalizes partial or malformed stored config', () => {
    const settings = getDshProviderSettings({
      providerConfigs: { dsh: { enabled: true, cliPath: ' /bin/dsh ', cliPathsByHost: { h: ' /a ' }, dshHome: ' /tmp/home ', junk: 1 } },
    });
    expect(settings.enabled).toBe(true);
    expect(settings.cliPath).toBe('/bin/dsh');
    expect(settings.cliPathsByHost).toEqual({ h: '/a' });
    expect(settings.dshHome).toBe('/tmp/home');
  });

  it('merges partial updates and keeps normalization', () => {
    const bag: Record<string, unknown> = {};
    updateDshProviderSettings(bag, { enabled: true });
    updateDshProviderSettings(bag, { dshHome: '/tmp/alt-home' });
    const settings = getDshProviderSettings(bag);
    expect(settings.enabled).toBe(true);
    expect(settings.dshHome).toBe('/tmp/alt-home');
  });
});
