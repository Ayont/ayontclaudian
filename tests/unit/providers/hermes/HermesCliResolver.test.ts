const mockGetHostnameKey = jest.fn(() => 'host-a');

jest.mock('../../../../src/utils/env', () => ({
  ...jest.requireActual('../../../../src/utils/env'),
  getHostnameKey: () => mockGetHostnameKey(),
}));

import { HermesCliResolver } from '../../../../src/providers/hermes/runtime/HermesCliResolver';
import * as cliBinaryLocator from '../../../../src/utils/cliBinaryLocator';

function createSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
  return { providerConfigs: { hermes: config } };
}

describe('HermesCliResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHostnameKey.mockReturnValue('host-a');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers the path configured for this host', () => {
    jest.spyOn(cliBinaryLocator, 'resolveConfiguredCliPath')
      .mockImplementation((value) => (value ? `resolved:${value}` : null));
    const findBinary = jest.spyOn(cliBinaryLocator, 'findCliBinaryPath');

    expect(new HermesCliResolver().resolveFromSettings(createSettings({
      cliPathsByHost: { 'host-a': '/opt/hermes/bin/hermes', 'host-b': '/other/hermes' },
    }))).toBe('resolved:/opt/hermes/bin/hermes');
    expect(findBinary).not.toHaveBeenCalled();
  });

  it('falls back to `hermes` on PATH when nothing is configured', () => {
    jest.spyOn(cliBinaryLocator, 'resolveConfiguredCliPath').mockReturnValue(null);
    const findBinary = jest.spyOn(cliBinaryLocator, 'findCliBinaryPath')
      .mockReturnValue('/usr/local/bin/hermes');

    expect(new HermesCliResolver().resolveFromSettings(createSettings()))
      .toBe('/usr/local/bin/hermes');
    expect(findBinary).toHaveBeenCalledWith('hermes', undefined);
  });

  it('searches the PATH the user configured for this provider', () => {
    jest.spyOn(cliBinaryLocator, 'resolveConfiguredCliPath').mockReturnValue(null);
    const findBinary = jest.spyOn(cliBinaryLocator, 'findCliBinaryPath').mockReturnValue(null);

    new HermesCliResolver().resolveFromSettings(createSettings({
      environmentVariables: 'PATH=/opt/hermes/bin',
    }));

    expect(findBinary).toHaveBeenCalledWith('hermes', '/opt/hermes/bin');
  });

  it('caches a miss so a missing CLI does not rescan PATH forever', () => {
    jest.spyOn(cliBinaryLocator, 'resolveConfiguredCliPath').mockReturnValue(null);
    const findBinary = jest.spyOn(cliBinaryLocator, 'findCliBinaryPath').mockReturnValue(null);
    const resolver = new HermesCliResolver();
    const settings = createSettings();

    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(findBinary).toHaveBeenCalledTimes(1);

    resolver.reset();
    expect(resolver.resolveFromSettings(settings)).toBeNull();
    expect(findBinary).toHaveBeenCalledTimes(2);
  });

  it('re-resolves when the configured path changes', () => {
    jest.spyOn(cliBinaryLocator, 'resolveConfiguredCliPath')
      .mockImplementation((value) => (value ? `resolved:${value}` : null));
    const resolver = new HermesCliResolver();

    expect(resolver.resolveFromSettings(createSettings({
      cliPathsByHost: { 'host-a': '/a/hermes' },
    }))).toBe('resolved:/a/hermes');
    expect(resolver.resolveFromSettings(createSettings({
      cliPathsByHost: { 'host-a': '/b/hermes' },
    }))).toBe('resolved:/b/hermes');
  });
});
