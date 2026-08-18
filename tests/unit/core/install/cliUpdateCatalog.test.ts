import { getCliUpdateSpec, getPreferredUpdateCommand } from '@/core/install/cliUpdateCatalog';

describe('cliUpdateCatalog', () => {
  it('maps Claude and Codex to npm packages', () => {
    expect(getCliUpdateSpec('claude')?.npmPackage).toBe('@anthropic-ai/claude-code');
    expect(getPreferredUpdateCommand('claude', 'darwin')).toBe(
      'npm install -g @anthropic-ai/claude-code@latest',
    );
    expect(getPreferredUpdateCommand('codex', 'linux')).toBe(
      'npm install -g @openai/codex@latest',
    );
  });

  it('falls back to the install command when there is no npm package', () => {
    const command = getPreferredUpdateCommand('grok', 'darwin');
    expect(command).toContain('x.ai/cli/install.sh');
  });

  it('updates Antigravity via the native `agy update` command', () => {
    expect(getPreferredUpdateCommand('antigravity', 'darwin')).toBe('agy update');
    expect(getPreferredUpdateCommand('antigravity', 'linux')).toBe('agy update');
  });

  it('upgrades uv-installed CLIs with uv tool upgrade', () => {
    expect(getPreferredUpdateCommand('vibe', 'darwin')).toBe('uv tool upgrade mistral-vibe');
    expect(getPreferredUpdateCommand('kimi', 'linux')).toBe('uv tool upgrade kimi-cli');
  });

  it('upgrades the modern Kimi Code binary, not the legacy kimi-cli package', () => {
    const cliPath = '/Users/ayont/.kimi-code/bin/kimi';
    expect(getCliUpdateSpec('kimi', cliPath)?.npmPackage).toBe('@moonshot-ai/kimi-code');
    expect(getCliUpdateSpec('kimi', cliPath)?.pypiPackage).toBeUndefined();
    expect(getPreferredUpdateCommand('kimi', 'darwin', cliPath)).toBe(`"${cliPath}" upgrade`);
  });

  it('still upgrades a uv kimi-cli install via PyPI', () => {
    const cliPath = '/Users/ayont/.local/share/uv/tools/kimi-cli/bin/kimi-cli';
    expect(getCliUpdateSpec('kimi', cliPath)?.pypiPackage).toBe('kimi-cli');
    expect(getPreferredUpdateCommand('kimi', 'linux', cliPath)).toBe('uv tool upgrade kimi-cli');
  });

  it('exposes PyPI packages for latest-version probes', () => {
    expect(getCliUpdateSpec('vibe')?.pypiPackage).toBe('mistral-vibe');
    expect(getCliUpdateSpec('kimi')?.pypiPackage).toBe('kimi-cli');
  });

  it('returns null for unknown providers', () => {
    expect(getCliUpdateSpec('nope')).toBeNull();
    expect(getPreferredUpdateCommand('nope', 'darwin')).toBeNull();
  });
});
