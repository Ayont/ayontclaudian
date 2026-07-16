import * as fs from 'fs';

import { GrokCliResolver } from '@/providers/grok/runtime/GrokCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedStat = fs.statSync as jest.Mock;

describe('GrokCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('resolves the configured CLI path when the file exists', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: { cliPath: '/mock/grok' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/grok');
  });

  it('falls back to the alternate binary name discovered on an added PATH entry', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/custom/bin/grok-cli') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: {} } };

    expect(resolver.resolveFromSettings(settings, '/custom/bin')).toBe('/custom/bin/grok-cli');
  });

  it('does not re-hit the filesystem for repeated resolves with the same inputs', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: { cliPath: '/mock/grok' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/grok');
    expect(resolver.resolveFromSettings(settings)).toBe('/mock/grok');
    expect(resolver.isAvailable(settings)).toBe(true);
    expect(mockedStat).toHaveBeenCalledTimes(1);
  });

  it('caches misses instead of rescanning PATH on every call', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: {} } };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    const callsAfterFirst = mockedStat.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolver.isAvailable(settings)).toBe(false);
    expect(mockedStat.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-resolves when the configured path changes', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/other/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const first = { providerConfigs: { grok: { cliPath: '/mock/grok' } } };
    const second = { providerConfigs: { grok: { cliPath: '/other/grok' } } };

    expect(resolver.resolveFromSettings(first)).toBeNull();
    expect(resolver.resolveFromSettings(second)).toBe('/other/grok');
  });

  it('treats a changed additionalPath as a different lookup', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/custom/bin/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: {} } };

    expect(resolver.resolveFromSettings(settings, '/nowhere/bin')).toBeNull();
    expect(resolver.resolveFromSettings(settings, '/custom/bin')).toBe('/custom/bin/grok');
  });

  it('reset() forces a fresh filesystem lookup', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/grok') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new GrokCliResolver();
    const settings = { providerConfigs: { grok: { cliPath: '/mock/grok' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/grok');
    expect(mockedStat).toHaveBeenCalledTimes(1);

    resolver.reset();

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/grok');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });
});
