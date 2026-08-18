import {
  getClineProviderSettings,
  updateClineProviderSettings,
} from '@/providers/cline/settings';

describe('Cline settings', () => {
  it('ships disabled with ClinePass as the default API provider', () => {
    const settings = getClineProviderSettings({});
    expect(settings.enabled).toBe(false);
    expect(settings.apiProvider).toBe('cline-pass');
    expect(settings.thinking).toBe('medium');
    expect(settings.permissionMode).toBe('yolo');
    expect(settings.compaction).toBe('agentic');
    expect(settings.retries).toBe(6);
  });

  it('persists api provider, thinking, and custom models', () => {
    const bag: Record<string, unknown> = {};
    updateClineProviderSettings(bag, {
      enabled: true,
      apiProvider: 'anthropic',
      thinking: 'xhigh',
      customModels: 'anthropic/claude-sonnet-4.6',
    });
    const next = getClineProviderSettings(bag);
    expect(next.enabled).toBe(true);
    expect(next.apiProvider).toBe('anthropic');
    expect(next.thinking).toBe('xhigh');
    expect(next.customModels).toBe('anthropic/claude-sonnet-4.6');
  });
});
