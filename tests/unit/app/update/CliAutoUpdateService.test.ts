import {
  type CliAutoUpdateMode,
  isAutoCycleDue,
  parseCliAutoUpdateMode,
  planAutoUpdates,
} from '@/app/update/CliAutoUpdateService';
import type { ProviderUpdateInfo } from '@/core/install/CliUpdateService';

function info(overrides: Partial<ProviderUpdateInfo>): ProviderUpdateInfo {
  return {
    providerId: 'codex',
    displayName: 'Codex',
    currentVersion: '1.0.0',
    latestVersion: '1.1.0',
    updateAvailable: true,
    updateCommand: 'npm install -g @openai/codex@latest',
    ...overrides,
  };
}

describe('CliAutoUpdateService planning helpers', () => {
  it('parses the auto-update mode with a safe default', () => {
    expect(parseCliAutoUpdateMode('auto')).toBe<CliAutoUpdateMode>('auto');
    expect(parseCliAutoUpdateMode('notify')).toBe<CliAutoUpdateMode>('notify');
    expect(parseCliAutoUpdateMode('off')).toBe<CliAutoUpdateMode>('off');
    expect(parseCliAutoUpdateMode(undefined)).toBe<CliAutoUpdateMode>('auto');
    expect(parseCliAutoUpdateMode('yolo')).toBe<CliAutoUpdateMode>('auto');
  });

  it('runs a cycle when never run, and again only after the interval elapsed', () => {
    const now = 1_000_000;
    const hour = 3_600_000;
    expect(isAutoCycleDue(null, 24 * hour, now)).toBe(true);
    expect(isAutoCycleDue(now - 23 * hour, 24 * hour, now)).toBe(false);
    expect(isAutoCycleDue(now - 25 * hour, 24 * hour, now)).toBe(true);
  });

  it('plans only providers that have both an available update and a command', () => {
    const planned = planAutoUpdates([
      info({}),
      info({ providerId: 'claude', updateAvailable: false }),
      info({ providerId: 'opencode', updateCommand: null }),
    ]);
    expect(planned.map((entry) => entry.providerId)).toEqual(['codex']);
  });
});