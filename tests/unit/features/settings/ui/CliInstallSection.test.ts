import { describeProviderInstallStatus } from '@/features/settings/ui/CliInstallSection';

describe('describeProviderInstallStatus', () => {
  it('highlights a detected CLI update', () => {
    expect(describeProviderInstallStatus({
      providerId: 'claude',
      displayName: 'Claude Code',
      currentVersion: '2.1.0',
      latestVersion: '2.2.0',
      updateAvailable: true,
      updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
    })).toEqual({
      desc: 'Update 2.2.0 (aktuell 2.1.0)',
      highlightUpdate: true,
    });
  });

  it('shows the installed version when current', () => {
    expect(describeProviderInstallStatus({
      providerId: 'claude',
      displayName: 'Claude Code',
      currentVersion: '2.2.0',
      latestVersion: '2.2.0',
      updateAvailable: false,
      updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
    })).toEqual({
      desc: '✓ installiert · 2.2.0',
      highlightUpdate: false,
    });
  });

  it('returns null when the check produced nothing', () => {
    expect(describeProviderInstallStatus(null)).toBeNull();
  });

  it('does not highlight an update when the latest version is unknown', () => {
    expect(describeProviderInstallStatus({
      providerId: 'vibe',
      displayName: 'Vibe (Mistral)',
      currentVersion: '2.20.0',
      latestVersion: null,
      updateAvailable: false,
      updateCommand: 'uv tool upgrade mistral-vibe',
    })).toEqual({
      desc: '✓ installiert · 2.20.0',
      highlightUpdate: false,
    });
  });
});
