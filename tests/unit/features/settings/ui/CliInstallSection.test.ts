import {
  applyCliProgressVisual,
  describeProviderInstallStatus,
} from '@/features/settings/ui/CliInstallSection';

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

describe('applyCliProgressVisual', () => {
  it('moves between determinate, indeterminate, and complete states without inline widths', () => {
    const classes = new Set<string>();
    const progressWrap = {
      classList: {
        toggle: (name: string, enabled: boolean) => {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
    } as unknown as HTMLElement;
    const properties = new Map<string, string>();
    const progressBar = {
      style: {
        removeProperty: jest.fn((name: string) => properties.delete(name)),
        setProperty: jest.fn((name: string, value: string) => properties.set(name, value)),
      },
    } as unknown as HTMLElement;

    applyCliProgressVisual(progressWrap, progressBar, { mode: 'determinate', percent: 37 });
    expect(properties.get('--claudian-cli-progress-width')).toBe('37%');
    expect(classes).not.toContain('is-indeterminate');
    expect(classes).not.toContain('is-complete');

    applyCliProgressVisual(progressWrap, progressBar, { mode: 'indeterminate' });
    expect(properties.has('--claudian-cli-progress-width')).toBe(false);
    expect(classes).toContain('is-indeterminate');
    expect(classes).not.toContain('is-complete');

    applyCliProgressVisual(progressWrap, progressBar, { mode: 'complete' });
    expect(classes).not.toContain('is-indeterminate');
    expect(classes).toContain('is-complete');
  });
});
