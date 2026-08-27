import { buildVibeLaunchSpec } from '@/providers/vibe/runtime/VibeLaunchSpec';

const BASE = {
  command: '/usr/local/bin/vibe',
  cwd: '/vault',
  env: {} as NodeJS.ProcessEnv,
  model: 'mistral-medium-3.5',
  permissionMode: 'normal' as const,
  prompt: 'hi',
};

describe('buildVibeLaunchSpec', () => {
  it('builds the verified 2.20 programmatic invocation', () => {
    expect(buildVibeLaunchSpec(BASE).args).toEqual([
      '--output',
      'streaming',
      '--trust',
      '--agent',
      'default',
      '--workdir',
      '/vault',
      '--add-dir',
      '/vault',
      '-p',
      'hi',
    ]);
  });

  it('adds --yolo for the yolo posture (verified vibe 2.20)', () => {
    const spec = buildVibeLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    expect(spec.args).toContain('--yolo');
    expect(spec.args[spec.args.indexOf('--agent') + 1]).toBe('auto-approve');
  });

  it('maps plan mode to --agent plan', () => {
    const spec = buildVibeLaunchSpec({ ...BASE, permissionMode: 'plan' });
    expect(spec.args[spec.args.indexOf('--agent') + 1]).toBe('plan');
    expect(spec.args).not.toContain('--yolo');
  });

  it('can run a plan agent without trusting the workspace', () => {
    const spec = buildVibeLaunchSpec({
      ...BASE,
      permissionMode: 'plan',
      trustWorkspace: false,
    });

    expect(spec.args).not.toContain('--trust');
    expect(spec.args).not.toContain('--yolo');
    expect(spec.args[spec.args.indexOf('--agent') + 1]).toBe('plan');
  });

  it('passes --max-turns and --max-tokens when set', () => {
    const spec = buildVibeLaunchSpec({ ...BASE, maxTurns: 8, maxTokens: 32000 });
    expect(spec.args[spec.args.indexOf('--max-turns') + 1]).toBe('8');
    expect(spec.args[spec.args.indexOf('--max-tokens') + 1]).toBe('32000');
  });

  it('uses a custom agent name in normal mode', () => {
    const spec = buildVibeLaunchSpec({ ...BASE, agent: 'reviewer' });
    expect(spec.args[spec.args.indexOf('--agent') + 1]).toBe('reviewer');
  });
});
