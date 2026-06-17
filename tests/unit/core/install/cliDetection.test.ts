jest.mock('@/utils/cliBinaryLocator', () => ({
  findCliBinaryPath: jest.fn(),
}));

import { isCliInstalled } from '@/core/install/cliDetection';
import { findCliBinaryPath } from '@/utils/cliBinaryLocator';

const mockedFind = findCliBinaryPath as jest.MockedFunction<typeof findCliBinaryPath>;

describe('isCliInstalled', () => {
  beforeEach(() => {
    mockedFind.mockReset();
  });

  it('returns false for an unknown provider without probing PATH', () => {
    expect(isCliInstalled('does-not-exist')).toBe(false);
    expect(mockedFind).not.toHaveBeenCalled();
  });

  it('detects a provider via its primary binary', () => {
    mockedFind.mockImplementation((binary) => (binary === 'codex' ? '/usr/bin/codex' : null));
    expect(isCliInstalled('codex')).toBe(true);
  });

  it('detects Kimi only via the alias when the primary binary is absent', () => {
    // Modern `kimi-cli` missing, but the uv-installed `kimi-legacy` alias exists.
    mockedFind.mockImplementation((binary) =>
      binary === 'kimi-legacy' ? '/home/u/.local/bin/kimi-legacy' : null,
    );
    expect(isCliInstalled('kimi')).toBe(true);
  });

  it('returns false when neither the binary nor any alias is on PATH', () => {
    mockedFind.mockReturnValue(null);
    expect(isCliInstalled('kimi')).toBe(false);
    // Probed the primary plus both aliases.
    expect(mockedFind).toHaveBeenCalledWith('kimi-cli', undefined);
    expect(mockedFind).toHaveBeenCalledWith('kimi', undefined);
    expect(mockedFind).toHaveBeenCalledWith('kimi-legacy', undefined);
  });
});
