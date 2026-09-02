import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  it('updates Hermes via its native `hermes update` (git pull + reinstall), not the installer script', () => {
    expect(getPreferredUpdateCommand('hermes', 'darwin')).toBe('hermes update');
    expect(getPreferredUpdateCommand('hermes', 'win32')).toBe('hermes update');
  });

  it('updates npm-installed DeepSeek Harness and Freebuff through their npm packages', () => {
    expect(getCliUpdateSpec('dsh')?.npmPackage).toBe('@deepseek-ai/dsh');
    expect(getPreferredUpdateCommand('dsh', 'linux')).toBe('npm install -g @deepseek-ai/dsh@latest');
    expect(getCliUpdateSpec('freebuff')?.npmPackage).toBe('freebuff');
    expect(getPreferredUpdateCommand('freebuff', 'darwin')).toBe('npm install -g freebuff@latest');
  });

  it('upgrades uv-installed CLIs with uv tool upgrade', () => {
    expect(getPreferredUpdateCommand('vibe', 'darwin')).toBe('uv tool upgrade mistral-vibe');
    expect(getPreferredUpdateCommand('kimi', 'linux')).toBe('uv tool upgrade kimi-cli');
  });

  it('upgrades the modern Kimi Code binary, not the legacy kimi-cli package', () => {
    const cliPath = '/Users/ayont/.kimi-code/bin/kimi';
    expect(getCliUpdateSpec('kimi', cliPath)?.npmPackage).toBe('@moonshot-ai/kimi-code');
    expect(getCliUpdateSpec('kimi', cliPath)?.pypiPackage).toBeUndefined();
    // `kimi upgrade` on native installs can exit 0 after only printing a curl
    // command (it currently mis-detects macOS as Windows). Re-run the official
    // installer instead — that is the command the CLI itself tells users to run.
    expect(getPreferredUpdateCommand('kimi', 'darwin', cliPath)).toBe(
      'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    );
    expect(getPreferredUpdateCommand('kimi', 'win32', cliPath)).toBe(
      'powershell -NoProfile -Command "irm https://code.kimi.com/kimi-code/install.ps1 | iex"',
    );
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

  it('upgrades a standalone opencode with its own upgrade command, not npm', () => {
    const cliPath = '/Users/ayont/.opencode/bin/opencode';
    expect(getPreferredUpdateCommand('opencode', 'darwin', cliPath)).toBe('opencode upgrade');
    expect(getPreferredUpdateCommand('opencode', 'linux', cliPath)).toBe('opencode upgrade');
  });

  it('keeps npm updates for npm-installed CLIs even when a vendor dir exists elsewhere', () => {
    const cliPath = '/Users/ayont/.npm-global/bin/opencode';
    expect(getPreferredUpdateCommand('opencode', 'darwin', cliPath)).toBe(
      'npm install -g opencode-ai@latest',
    );
  });

  it('resolves symlinks so homebrew aliases of standalone installs upgrade natively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudian-symlink-'));
    const target = path.join(dir, '.opencode', 'bin');
    fs.mkdirSync(target, { recursive: true });
    const binary = path.join(target, 'opencode');
    fs.writeFileSync(binary, '#!/bin/sh\n');
    const link = path.join(dir, 'brew-bin-opencode');
    fs.symlinkSync(binary, link);
    try {
      expect(getPreferredUpdateCommand('opencode', 'darwin', link)).toBe('opencode upgrade');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('upgrades the native Claude build and the standalone Grok with self-update commands', () => {
    expect(getPreferredUpdateCommand('claude', 'darwin', '/Users/ayont/.local/bin/claude')).toBe(
      'claude update',
    );
    expect(getPreferredUpdateCommand('grok', 'darwin', '/Users/ayont/.grok/bin/grok')).toBe(
      'grok update',
    );
  });

  it('still uses the npm package when a native-looking provider is npm-managed', () => {
    const cliPath = '/Users/ayont/.npm-global/bin/claude';
    expect(getPreferredUpdateCommand('claude', 'darwin', cliPath)).toBe(
      'npm install -g @anthropic-ai/claude-code@latest',
    );
  });

  it('keeps documented priority without a resolved path (npm first, installer fallback)', () => {
    expect(getPreferredUpdateCommand('opencode', 'darwin')).toBe(
      'npm install -g opencode-ai@latest',
    );
    expect(getPreferredUpdateCommand('grok', 'darwin')).toContain('x.ai/cli/install.sh');
  });
});
