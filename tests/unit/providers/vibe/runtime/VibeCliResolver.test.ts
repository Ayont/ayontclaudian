import * as fs from 'fs';

import { VibeCliResolver } from '@/providers/vibe/runtime/VibeCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedStat = fs.statSync as jest.Mock;

describe('VibeCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('resolves the configured CLI path when the file exists', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/vibe') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new VibeCliResolver();
    const settings = { providerConfigs: { vibe: { cliPath: '/mock/vibe' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/vibe');
  });

  it('does not re-hit the filesystem for repeated resolves with the same inputs', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/vibe') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new VibeCliResolver();
    const settings = { providerConfigs: { vibe: { cliPath: '/mock/vibe' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/vibe');
    expect(resolver.resolveFromSettings(settings)).toBe('/mock/vibe');
    expect(resolver.isAvailable(settings)).toBe(true);
    expect(mockedStat).toHaveBeenCalledTimes(1);
  });

  it('caches misses instead of rescanning PATH on every call', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const resolver = new VibeCliResolver();
    const settings = { providerConfigs: { vibe: {} } };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    const callsAfterFirst = mockedStat.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolver.isAvailable(settings)).toBe(false);
    expect(mockedStat.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-resolves when the configured path changes', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/other/vibe') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new VibeCliResolver();
    const first = { providerConfigs: { vibe: { cliPath: '/mock/vibe' } } };
    const second = { providerConfigs: { vibe: { cliPath: '/other/vibe' } } };

    expect(resolver.resolveFromSettings(first)).toBeNull();
    expect(resolver.resolveFromSettings(second)).toBe('/other/vibe');
  });

  it('reset() forces a fresh filesystem lookup', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/vibe') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new VibeCliResolver();
    const settings = { providerConfigs: { vibe: { cliPath: '/mock/vibe' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/vibe');
    expect(mockedStat).toHaveBeenCalledTimes(1);

    resolver.reset();

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/vibe');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });
});
