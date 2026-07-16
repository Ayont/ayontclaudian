import * as fs from 'fs';

import { AntigravityCliResolver } from '@/providers/antigravity/runtime/AntigravityCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedStat = fs.statSync as jest.Mock;

describe('AntigravityCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(false);
  });

  it('resolves the configured CLI path when the file exists', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/agy') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new AntigravityCliResolver();
    const settings = { providerConfigs: { antigravity: { cliPath: '/mock/agy' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/agy');
  });

  it('does not re-hit the filesystem for repeated resolves with the same inputs', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/agy') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new AntigravityCliResolver();
    const settings = { providerConfigs: { antigravity: { cliPath: '/mock/agy' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/agy');
    expect(resolver.resolveFromSettings(settings)).toBe('/mock/agy');
    expect(resolver.isAvailable(settings)).toBe(true);
    expect(mockedStat).toHaveBeenCalledTimes(1);
  });

  it('caches misses instead of rescanning PATH on every call', () => {
    mockedStat.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const resolver = new AntigravityCliResolver();
    const settings = { providerConfigs: { antigravity: {} } };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    const callsAfterFirst = mockedStat.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolver.isAvailable(settings)).toBe(false);
    expect(mockedStat.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-resolves when the configured path changes', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/other/agy') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new AntigravityCliResolver();
    const first = { providerConfigs: { antigravity: { cliPath: '/mock/agy' } } };
    const second = { providerConfigs: { antigravity: { cliPath: '/other/agy' } } };

    expect(resolver.resolveFromSettings(first)).toBeNull();
    expect(resolver.resolveFromSettings(second)).toBe('/other/agy');
  });

  it('reset() forces a fresh filesystem lookup', () => {
    mockedStat.mockImplementation((filePath: string) => {
      if (filePath === '/mock/agy') {
        return { isFile: () => true };
      }
      throw new Error(`ENOENT: ${filePath}`);
    });

    const resolver = new AntigravityCliResolver();
    const settings = { providerConfigs: { antigravity: { cliPath: '/mock/agy' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/agy');
    expect(mockedStat).toHaveBeenCalledTimes(1);

    resolver.reset();

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/agy');
    expect(mockedStat).toHaveBeenCalledTimes(2);
  });
});
