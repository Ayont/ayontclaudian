import { buildGrokLaunchSpec } from '@/providers/grok/runtime/GrokLaunchSpec';

const base = {
  command: '/usr/local/bin/grok',
  cwd: '/vault',
  env: {} as NodeJS.ProcessEnv,
  model: 'grok-build',
  permissionMode: 'normal' as const,
  prompt: 'Hallo',
};

describe('buildGrokLaunchSpec', () => {
  const flagValue = (args: string[], flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  it('runs the default agent when no bot is selected', () => {
    const spec = buildGrokLaunchSpec(base);

    expect(spec.args).not.toContain('--agent');
  });

  it('selects a named Grok bot', () => {
    const spec = buildGrokLaunchSpec({ ...base, agentName: 'explore' });

    expect(flagValue(spec.args, '--agent')).toBe('explore');
  });

  it('puts --agent before the prompt, which must stay last', () => {
    const spec = buildGrokLaunchSpec({ ...base, agentName: 'explore' });

    expect(spec.args.indexOf('--agent')).toBeLessThan(spec.args.indexOf('-p'));
    expect(spec.args[spec.args.length - 1]).toBe('Hallo');
  });

  it('ignores a blank agent name instead of passing an empty flag', () => {
    const spec = buildGrokLaunchSpec({ ...base, agentName: '   ' });

    expect(spec.args).not.toContain('--agent');
  });

  it('keys the launch on the agent, so switching bots starts a fresh process', () => {
    const withExplore = buildGrokLaunchSpec({ ...base, agentName: 'explore' });
    const withPlan = buildGrokLaunchSpec({ ...base, agentName: 'plan' });
    const withNone = buildGrokLaunchSpec(base);

    expect(withExplore.launchKey).not.toBe(withPlan.launchKey);
    expect(withExplore.launchKey).not.toBe(withNone.launchKey);
  });

  it('passes a supported reasoning effort and ignores one the model does not offer', () => {
    const fast = buildGrokLaunchSpec({
      ...base,
      model: 'grok-4.7-build-fast',
      reasoningEffort: 'xhigh',
    });
    const previous = buildGrokLaunchSpec({
      ...base,
      model: 'grok-4.5',
      reasoningEffort: 'xhigh',
    });

    expect(flagValue(fast.args, '--reasoning-effort')).toBe('xhigh');
    expect(fast.args.indexOf('--reasoning-effort')).toBeLessThan(fast.args.indexOf('-p'));
    expect(previous.args).not.toContain('--reasoning-effort');
    expect(fast.launchKey).not.toBe(previous.launchKey);
  });

  it('still passes the vault as the working directory, so a bot reads the vault', () => {
    const spec = buildGrokLaunchSpec({ ...base, agentName: 'explore' });

    expect(flagValue(spec.args, '--cwd')).toBe('/vault');
  });
});
