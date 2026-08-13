import {
  isElectronHostBinary,
  posixShellQuote,
  resolveClineSpawnSpec,
  sanitizeClineSpawnEnv,
} from '@/providers/cline/runtime/ClineProcess';

describe('sanitizeClineSpawnEnv', () => {
  it('strips Electron host variables so the Bun CLI is not run as Electron', () => {
    const env = sanitizeClineSpawnEnv({
      PATH: '/usr/bin',
      HOME: '/Users/ayont',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ASAR: '1',
      ATOM_SHELL_INTERNAL_RUN_AS_NODE: '1',
      CLINE_DEBUG: '1',
    });
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.ELECTRON_NO_ASAR).toBeUndefined();
    expect(env.ATOM_SHELL_INTERNAL_RUN_AS_NODE).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.CLINE_DEBUG).toBe('1');
  });
});

describe('isElectronHostBinary', () => {
  it('detects Obsidian and Electron hosts, not a real node', () => {
    expect(isElectronHostBinary('/Applications/Obsidian.app/Contents/MacOS/Obsidian')).toBe(true);
    expect(isElectronHostBinary('/usr/local/bin/node')).toBe(false);
  });
});

describe('posixShellQuote', () => {
  it('quotes values so login-shell auth commands stay intact', () => {
    expect(posixShellQuote('/Users/ayont/.npm-global/bin/cline')).toBe(
      "'/Users/ayont/.npm-global/bin/cline'",
    );
    expect(posixShellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('resolveClineSpawnSpec', () => {
  it('keeps the Node wrapper and does not rewrite it to .cline', () => {
    const spec = resolveClineSpawnSpec({
      command: '/Users/ayont/.npm-global/bin/cline',
      args: ['--yolo', '--json', 'hi'],
    });
    expect(spec.command).not.toMatch(/\.cline$/);
    expect(spec.args.join(' ')).toContain('--json');
    expect(spec.args.join(' ')).toContain('hi');
  });
});
