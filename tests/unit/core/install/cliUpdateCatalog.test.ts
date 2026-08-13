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

  it('returns null for unknown providers', () => {
    expect(getCliUpdateSpec('nope')).toBeNull();
    expect(getPreferredUpdateCommand('nope', 'darwin')).toBeNull();
  });
});
