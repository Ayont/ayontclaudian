import { shouldBypassClineVersionProbe } from '@/core/diagnostics/providerHealthCheck';

describe('shouldBypassClineVersionProbe', () => {
  it('lets an enabled Cline CLI start even when Electron kills --version', () => {
    expect(shouldBypassClineVersionProbe({
      providerId: 'cline',
      enabled: true,
      command: '/Users/ayont/.npm-global/bin/cline',
    })).toBe(true);
  });

  it('does not bypass other providers or a missing Cline binary', () => {
    expect(shouldBypassClineVersionProbe({
      providerId: 'codex',
      enabled: true,
      command: '/usr/local/bin/codex',
    })).toBe(false);
    expect(shouldBypassClineVersionProbe({
      providerId: 'cline',
      enabled: true,
      command: null,
    })).toBe(false);
    expect(shouldBypassClineVersionProbe({
      providerId: 'cline',
      enabled: false,
      command: '/usr/local/bin/cline',
    })).toBe(false);
  });
});
