import {
  getCliInstallSpec,
  getInstallMethods,
  getPreferredInstallCommand,
  normalizeInstallPlatform,
} from '@/core/install/cliInstallCatalog';
import { parseInstallProgress } from '@/core/install/CliInstaller';

describe('cliInstallCatalog', () => {
  it('exposes the Vibe (Mistral) spec with the vibe binary', () => {
    const spec = getCliInstallSpec('vibe');
    expect(spec).not.toBeNull();
    expect(spec?.binary).toBe('vibe');
    expect(spec?.docsUrl).toContain('mistral');
  });

  it('returns null for an unknown provider', () => {
    expect(getCliInstallSpec('does-not-exist')).toBeNull();
  });

  it('offers the installer script first on macOS for Vibe, uv on Windows', () => {
    expect(getInstallMethods('vibe', 'darwin')[0].command).toBe(
      'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
    );
    expect(getInstallMethods('vibe', 'win32')[0].command).toBe('uv tool install mistral-vibe');
  });

  it('falls back to the default methods for an unlisted platform', () => {
    expect(getInstallMethods('vibe', 'freebsd' as NodeJS.Platform)[0].command).toBe(
      'uv tool install mistral-vibe',
    );
  });

  it('picks the first runnable command, skipping docs-only methods', () => {
    expect(getPreferredInstallCommand('vibe', 'darwin')?.command).toBe(
      'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
    );
    // antigravity is docs-only → no runnable command.
    expect(getPreferredInstallCommand('antigravity', 'darwin')).toBeNull();
    expect(getPreferredInstallCommand('unknown', 'darwin')).toBeNull();
  });

  it('normalizes platforms to the supported set', () => {
    expect(normalizeInstallPlatform('darwin')).toBe('darwin');
    expect(normalizeInstallPlatform('win32')).toBe('win32');
    expect(normalizeInstallPlatform('aix' as NodeJS.Platform)).toBe('default');
  });
});

describe('parseInstallProgress', () => {
  it('extracts a clamped percentage from a line', () => {
    expect(parseInstallProgress('Downloading 45%')).toBe(45);
    expect(parseInstallProgress('done 100 %')).toBe(100);
    expect(parseInstallProgress('weird 250%')).toBe(100);
  });

  it('returns null when there is no percentage', () => {
    expect(parseInstallProgress('Resolving dependencies...')).toBeNull();
    expect(parseInstallProgress('')).toBeNull();
  });
});
