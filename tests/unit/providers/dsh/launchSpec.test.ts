import { buildDshLaunchSpec } from '@/providers/dsh/runtime/DshLaunchSpec';

describe('buildDshLaunchSpec (dsh --profile headless)', () => {
  const base = {
    command: '/usr/local/bin/dsh',
    cwd: '/vault',
    env: { PATH: '/usr/bin' },
    prompt: 'Hallo Welt',
  };

  it('selects the headless profile and passes the prompt as one positional', () => {
    const spec = buildDshLaunchSpec({ ...base });
    expect(spec.args).toEqual(['--profile', 'headless', 'Hallo Welt']);
    expect(spec.command).toBe('/usr/local/bin/dsh');
    expect(spec.cwd).toBe('/vault');
  });

  it('keeps multi-line prompts intact in a single argv token', () => {
    const prompt = ['Zeile 1', '', 'Zeile 2 --nicht-ein-flag'].join('\n');
    const spec = buildDshLaunchSpec({ ...base, prompt });
    expect(spec.args[2]).toBe(prompt);
  });

  it('derives a launchKey independent of the prompt content (grok convention)', () => {
    // The launchKey identifies a launch CONFIGURATION, not the payload; grok's
    // spec does the same so downstream reuse/dedupe logic sees equal keys.
    const a = buildDshLaunchSpec({ ...base, prompt: 'a' });
    const b = buildDshLaunchSpec({ ...base, prompt: 'b' });
    expect(a.launchKey).toBe(b.launchKey);
    expect(JSON.parse(a.launchKey)).toMatchObject({ command: base.command, cwd: base.cwd });
  });

  it('carries env through untouched', () => {
    const env = { PATH: '/x', DSH_HOME: '/tmp/home' };
    const spec = buildDshLaunchSpec({ ...base, env });
    expect(spec.env.DSH_HOME).toBe('/tmp/home');
  });
});
