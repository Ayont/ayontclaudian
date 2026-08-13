import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildClineAuthArgs,
  buildClineAuthShellCommand,
  formatClineAuthStatus,
  parseClineProvidersFile,
  readClineAuthStatus,
} from '@/providers/cline/auth/ClineAuth';

const SAMPLE_PROVIDERS = {
  version: 1,
  lastUsedProvider: 'cline-pass',
  providers: {
    cline: {
      tokenSource: 'oauth',
      settings: {
        provider: 'cline',
        auth: {
          accessToken: 'secret-access-token-xyz',
          accountId: 'usr-01ABC',
          expiresAt: 1786566450000,
        },
      },
    },
    'cline-pass': {
      tokenSource: 'manual',
      settings: {
        provider: 'cline-pass',
        auth: { accessToken: 'secret-access-token-xyz', accountId: 'usr-01ABC' },
      },
    },
  },
};

describe('parseClineProvidersFile', () => {
  it('marks Cline and ClinePass as authenticated without exposing tokens', () => {
    const entries = parseClineProvidersFile(SAMPLE_PROVIDERS);
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: 'cline',
        authenticated: true,
        tokenSource: 'oauth',
        accountId: 'usr-01ABC',
      }),
      expect.objectContaining({
        providerId: 'cline-pass',
        authenticated: true,
        tokenSource: 'manual',
      }),
    ]));
    expect(JSON.stringify(entries)).not.toContain('secret-access-token-xyz');
  });
});

describe('formatClineAuthStatus', () => {
  it('describes the selected provider in German', () => {
    const entries = parseClineProvidersFile(SAMPLE_PROVIDERS);
    expect(formatClineAuthStatus(entries, 'cline-pass')).toContain('Angemeldet');
    expect(formatClineAuthStatus(entries, 'cline-pass')).toContain('ClinePass');
    expect(formatClineAuthStatus([], 'cline-pass')).toBe('Nicht angemeldet');
  });
});

describe('buildClineAuthArgs', () => {
  it('uses the documented OAuth command for ClinePass instead of the subscription URL', () => {
    expect(buildClineAuthArgs('cline-pass')).toEqual(['auth', 'cline']);
    expect(buildClineAuthArgs('cline')).toEqual(['auth', 'cline']);
    expect(buildClineAuthArgs('anthropic')).toEqual(['auth']);
  });
});

describe('buildClineAuthShellCommand', () => {
  it('builds a login-shell command that runs cline auth', () => {
    const command = buildClineAuthShellCommand('/usr/local/bin/cline', 'cline-pass');
    expect(command).toContain('auth');
    expect(command).toContain('cline');
    expect(command).not.toContain('app.cline.bot');
    expect(command).not.toContain('subscription');
  });
});

describe('readClineAuthStatus', () => {
  it('reads providers.json from a Cline home directory', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-home-'));
    const file = path.join(home, '.cline', 'data', 'settings', 'providers.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(SAMPLE_PROVIDERS));
    const entries = readClineAuthStatus(home);
    expect(entries.some((entry) => entry.providerId === 'cline-pass' && entry.authenticated)).toBe(true);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
