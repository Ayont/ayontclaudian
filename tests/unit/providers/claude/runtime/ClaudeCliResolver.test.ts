import * as fs from 'fs';

import { ClaudeCliResolver } from '@/providers/claude/runtime/ClaudeCliResolver';

jest.mock('fs');
jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getHostnameKey: () => 'current-host',
}));

const mockedExists = fs.existsSync as jest.Mock;
const mockedStat = fs.statSync as jest.Mock;

describe('ClaudeCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedExists.mockReturnValue(false);
  });

  it('resolves the configured CLI path when the file exists', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/mock/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ClaudeCliResolver();
    const settings = { providerConfigs: { claude: { cliPath: '/mock/claude' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/claude');
  });

  it('does not re-hit the filesystem for repeated resolves with the same inputs', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/mock/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ClaudeCliResolver();
    const settings = { providerConfigs: { claude: { cliPath: '/mock/claude' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/claude');
    expect(resolver.resolveFromSettings(settings)).toBe('/mock/claude');
    expect(mockedExists).toHaveBeenCalledTimes(1);
  });

  it('caches misses instead of rescanning on every call', () => {
    const resolver = new ClaudeCliResolver();
    const settings = { providerConfigs: { claude: {} } };

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    const callsAfterFirst = mockedExists.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(mockedExists.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-resolves when the configured path changes', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/other/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ClaudeCliResolver();
    const first = { providerConfigs: { claude: { cliPath: '/mock/claude' } } };
    const second = { providerConfigs: { claude: { cliPath: '/other/claude' } } };

    expect(resolver.resolveFromSettings(first)).toBeNull();
    expect(resolver.resolveFromSettings(second)).toBe('/other/claude');
  });

  it('reset() forces a fresh filesystem lookup', () => {
    mockedExists.mockImplementation((filePath: string) => filePath === '/mock/claude');
    mockedStat.mockReturnValue({ isFile: () => true });

    const resolver = new ClaudeCliResolver();
    const settings = { providerConfigs: { claude: { cliPath: '/mock/claude' } } };

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/claude');
    expect(mockedExists).toHaveBeenCalledTimes(1);

    resolver.reset();

    expect(resolver.resolveFromSettings(settings)).toBe('/mock/claude');
    expect(mockedExists).toHaveBeenCalledTimes(2);
  });
});
