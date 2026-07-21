import { buildAntigravityLaunchSpec } from '@/providers/antigravity/runtime/AntigravityLaunchSpec';

const BASE = {
  command: '/usr/local/bin/agy',
  cwd: '/vault',
  env: {} as NodeJS.ProcessEnv,
  prompt: 'hi',
};

describe('buildAntigravityLaunchSpec', () => {
  it('builds the verified base invocation (vault-only, no extras)', () => {
    const spec = buildAntigravityLaunchSpec(BASE);
    // `agy` parses with Go's `flag` package: `-p/--print/--prompt` is a STRING
    // flag whose value IS the prompt (`agy --print` with no value errors with
    // "flag needs an argument: -print"). All other flags must precede the
    // prompt, and there is NO `--` terminator (Go flag stops at the first bare
    // positional, which would silently drop later flags).
    expect(spec.args).toEqual([
      '--add-dir',
      '/vault',
      '--dangerously-skip-permissions',
      '-p',
      'hi',
    ]);
  });

  it('never emits a `--` terminator or a bare boolean --print (the agy parse bug)', () => {
    const spec = buildAntigravityLaunchSpec(BASE);
    expect(spec.args).not.toContain('--');
    // `-p` must be immediately followed by the prompt as its value.
    const pIndex = spec.args.indexOf('-p');
    expect(pIndex).toBeGreaterThan(-1);
    expect(spec.args[pIndex + 1]).toBe('hi');
    // Permission + workspace flags must come BEFORE the prompt value so Go's
    // flag parser actually applies them.
    expect(spec.args.indexOf('--dangerously-skip-permissions')).toBeLessThan(pIndex);
    expect(spec.args.indexOf('--add-dir')).toBeLessThan(pIndex);
  });

  it('defaults to YOLO (--dangerously-skip-permissions, no --sandbox) when no posture is given', () => {
    const spec = buildAntigravityLaunchSpec(BASE);
    expect(spec.args).toContain('--dangerously-skip-permissions');
    expect(spec.args).not.toContain('--sandbox');
  });

  it('passes --model "<name>" verbatim before the prompt when a model is given', () => {
    const spec = buildAntigravityLaunchSpec({ ...BASE, model: 'Gemini 3.1 Pro (High)' });
    const mIndex = spec.args.indexOf('--model');
    expect(mIndex).toBeGreaterThan(-1);
    // Exact name passed as a single argv element (no shell quoting needed).
    expect(spec.args[mIndex + 1]).toBe('Gemini 3.1 Pro (High)');
    // Must precede the prompt value.
    expect(mIndex).toBeLessThan(spec.args.indexOf('-p'));
  });

  it('omits --model when no model (uses agy default)', () => {
    expect(buildAntigravityLaunchSpec(BASE).args).not.toContain('--model');
    expect(buildAntigravityLaunchSpec({ ...BASE, model: '   ' }).args).not.toContain('--model');
  });

  it('passes --agent <name> verbatim before the prompt when a persona is given', () => {
    const spec = buildAntigravityLaunchSpec({ ...BASE, agent: 'architect' });
    const aIndex = spec.args.indexOf('--agent');
    expect(aIndex).toBeGreaterThan(-1);
    expect(spec.args[aIndex + 1]).toBe('architect');
    expect(aIndex).toBeLessThan(spec.args.indexOf('-p'));
  });

  it('omits --agent for "default", empty, or missing (uses agy default persona)', () => {
    expect(buildAntigravityLaunchSpec(BASE).args).not.toContain('--agent');
    expect(buildAntigravityLaunchSpec({ ...BASE, agent: 'default' }).args).not.toContain('--agent');
    expect(buildAntigravityLaunchSpec({ ...BASE, agent: '   ' }).args).not.toContain('--agent');
  });

  it('adds extra dirs via --add-dir (e.g. attachment temp dir), de-duped against cwd', () => {
    const spec = buildAntigravityLaunchSpec({ ...BASE, extraDirs: ['/tmp/claudian-agy-x', '/vault'] });
    const addDirArgs = spec.args.filter((_, i) => spec.args[i - 1] === '--add-dir');
    expect(addDirArgs).toContain('/tmp/claudian-agy-x');
    // cwd is already added once; the duplicate is dropped.
    expect(addDirArgs.filter((d) => d === '/vault')).toHaveLength(1);
  });

  it('reflects model + extraDirs + agent in the launch key', () => {
    const a = buildAntigravityLaunchSpec(BASE).launchKey;
    const b = buildAntigravityLaunchSpec({ ...BASE, model: 'Claude Opus 4.6 (Thinking)' }).launchKey;
    const c = buildAntigravityLaunchSpec({ ...BASE, extraDirs: ['/tmp/x'] }).launchKey;
    const d = buildAntigravityLaunchSpec({ ...BASE, agent: 'debugger' }).launchKey;
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    // The synthetic "default" persona must hash identically to omitting the
    // field entirely (both mean "no --agent flag").
    expect(a).toBe(buildAntigravityLaunchSpec({ ...BASE, agent: 'default' }).launchKey);
  });

  it('permissionMode "yolo" passes --dangerously-skip-permissions and omits --sandbox', () => {
    const spec = buildAntigravityLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    expect(spec.args).toContain('--dangerously-skip-permissions');
    expect(spec.args).not.toContain('--sandbox');
    // The prompt is the value of `-p` and comes last (no `--` terminator).
    expect(spec.args[spec.args.length - 2]).toBe('-p');
    expect(spec.args[spec.args.length - 1]).toBe('hi');
  });

  it('permissionMode "sandbox" passes --sandbox and NOT --dangerously-skip-permissions', () => {
    const spec = buildAntigravityLaunchSpec({ ...BASE, permissionMode: 'sandbox' });
    expect(spec.args).toContain('--sandbox');
    expect(spec.args).not.toContain('--dangerously-skip-permissions');
    // The prompt is the value of `-p` and comes last (no `--` terminator).
    expect(spec.args[spec.args.length - 2]).toBe('-p');
    expect(spec.args[spec.args.length - 1]).toBe('hi');
  });

  it('re-launches when the permission posture changes (distinct launch keys)', () => {
    const yolo = buildAntigravityLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    const sandbox = buildAntigravityLaunchSpec({ ...BASE, permissionMode: 'sandbox' });
    expect(yolo.launchKey).not.toBe(sandbox.launchKey);
  });

  it('adds --print-timeout with the configured value, and omits it when empty', () => {
    const withTimeout = buildAntigravityLaunchSpec({ ...BASE, printTimeout: '10m' });
    const idx = withTimeout.args.indexOf('--print-timeout');
    expect(idx).toBeGreaterThan(-1);
    expect(withTimeout.args[idx + 1]).toBe('10m');

    const noTimeout = buildAntigravityLaunchSpec({ ...BASE, printTimeout: '   ' });
    expect(noTimeout.args).not.toContain('--print-timeout');
  });

  it('vault-only passes only the vault --add-dir', () => {
    const spec = buildAntigravityLaunchSpec({
      ...BASE,
      workspaceScope: 'vault-only',
      homeDir: '/Users/me',
    });
    const addDirs = spec.args.filter((_, i) => spec.args[i - 1] === '--add-dir');
    expect(addDirs).toEqual(['/vault']);
  });

  it('allow-home adds the home directory as a second --add-dir', () => {
    const spec = buildAntigravityLaunchSpec({
      ...BASE,
      workspaceScope: 'allow-home',
      homeDir: '/Users/me',
    });
    const addDirs = spec.args.filter((_, i) => spec.args[i - 1] === '--add-dir');
    expect(addDirs).toEqual(['/vault', '/Users/me']);
  });

  it('allow-home does not duplicate --add-dir when home equals the vault', () => {
    const spec = buildAntigravityLaunchSpec({
      ...BASE,
      cwd: '/Users/me',
      workspaceScope: 'allow-home',
      homeDir: '/Users/me',
    });
    const addDirs = spec.args.filter((_, i) => spec.args[i - 1] === '--add-dir');
    expect(addDirs).toEqual(['/Users/me']);
  });

  it('encodes the new controls in the launch key so a settings change re-launches', () => {
    const a = buildAntigravityLaunchSpec(BASE);
    const b = buildAntigravityLaunchSpec({ ...BASE, permissionMode: 'sandbox' });
    const c = buildAntigravityLaunchSpec({ ...BASE, printTimeout: '5m' });
    const d = buildAntigravityLaunchSpec({
      ...BASE,
      workspaceScope: 'allow-home',
      homeDir: '/Users/me',
    });
    expect(a.launchKey).not.toBe(b.launchKey);
    expect(a.launchKey).not.toBe(c.launchKey);
    expect(a.launchKey).not.toBe(d.launchKey);
  });

  it('still resumes a conversation and keeps the prompt last', () => {
    const spec = buildAntigravityLaunchSpec({
      ...BASE,
      conversationId: 'conv-1',
      permissionMode: 'sandbox',
      printTimeout: '2m',
    });
    expect(spec.args).toContain('--conversation');
    expect(spec.args[spec.args.indexOf('--conversation') + 1]).toBe('conv-1');
    expect(spec.args).not.toContain('--');
    expect(spec.args[spec.args.length - 2]).toBe('-p');
    expect(spec.args[spec.args.length - 1]).toBe('hi');
  });
});
