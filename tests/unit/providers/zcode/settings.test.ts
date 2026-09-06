import {
  getResolvedZcodeCliPath,
  getZcodeProviderSettings,
  updateZcodeProviderSettings,
} from '@/providers/zcode/settings';

describe('ZCode Provider Settings', () => {
  it('returns valid defaults when settings are empty', () => {
    const settings = getZcodeProviderSettings({});
    expect(settings.enabled).toBe(false);
    expect(settings.baseURL).toBe('https://api.z.ai/api/anthropic');
    expect(settings.mode).toBe('api');
    expect(settings.reasoningEffort).toBe('max');
    expect(settings.permissionMode).toBe('normal');
  });

  it('updates provider settings cleanly and retrieves them', () => {
    const settingsBag: Record<string, unknown> = {};
    updateZcodeProviderSettings(settingsBag, (curr) => ({
      ...curr,
      enabled: true,
      apiKey: 'test-key-123',
      reasoningEffort: 'high',
      permissionMode: 'yolo',
    }));

    const retrieved = getZcodeProviderSettings(settingsBag);
    expect(retrieved.enabled).toBe(true);
    expect(retrieved.apiKey).toBe('test-key-123');
    expect(retrieved.reasoningEffort).toBe('high');
    expect(retrieved.permissionMode).toBe('yolo');
  });

  it('resolves hostname-specific CLI paths when available', () => {
    const settings = getZcodeProviderSettings({});
    settings.cliPath = '/usr/local/bin/zcode';
    settings.cliPathsByHost['my-mac'] = '/opt/homebrew/bin/zcode';

    expect(getResolvedZcodeCliPath(settings, 'my-mac')).toBe('/opt/homebrew/bin/zcode');
    expect(getResolvedZcodeCliPath(settings, 'other-host')).toBe('/usr/local/bin/zcode');
  });
});
