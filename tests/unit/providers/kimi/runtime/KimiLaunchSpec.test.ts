import type { BuildKimiLaunchSpecParams } from '@/providers/kimi/runtime/KimiLaunchSpec';
import { buildKimiLaunchSpec, detectKimiCliFlavor } from '@/providers/kimi/runtime/KimiLaunchSpec';

const BASE: BuildKimiLaunchSpecParams = {
  command: '/usr/local/bin/kimi-cli',
  cwd: '/vault',
  env: {} as NodeJS.ProcessEnv,
  prompt: 'hi',
  model: 'kimi-k2',
  thinking: true,
  agent: 'default',
  permissionMode: 'normal',
};

describe('buildKimiLaunchSpec permissionMode', () => {
  it('safe/normal passes neither --yolo nor --plan (--print auto-approves)', () => {
    const spec = buildKimiLaunchSpec({ ...BASE, permissionMode: 'normal' });
    expect(spec.args).not.toContain('--yolo');
    expect(spec.args).not.toContain('--plan');
    // Prompt is passed via `-p` and stays last.
    expect(spec.args[spec.args.length - 2]).toBe('-p');
    expect(spec.args[spec.args.length - 1]).toBe('hi');
  });

  it('permissionMode "yolo" is not passed in print mode because print auto-approves', () => {
    const spec = buildKimiLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    expect(spec.args).not.toContain('--yolo');
    expect(spec.args).not.toContain('--plan');
  });

  it('permissionMode "plan" is not passed in print mode because prompt+plan is invalid', () => {
    const spec = buildKimiLaunchSpec({ ...BASE, permissionMode: 'plan' });
    expect(spec.args).not.toContain('--plan');
    expect(spec.args).not.toContain('--yolo');
  });

  it('encodes permissionMode in the launch key so a change re-launches', () => {
    const normal = buildKimiLaunchSpec({ ...BASE, permissionMode: 'normal' });
    const yolo = buildKimiLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    const plan = buildKimiLaunchSpec({ ...BASE, permissionMode: 'plan' });
    expect(normal.launchKey).not.toBe(yolo.launchKey);
    expect(normal.launchKey).not.toBe(plan.launchKey);
    expect(yolo.launchKey).not.toBe(plan.launchKey);
  });
});

describe('buildKimiLaunchSpec CLI flavors', () => {
  it('detects modern Kimi Code versus legacy kimi-cli', () => {
    expect(detectKimiCliFlavor('/Users/me/.kimi-code/bin/kimi')).toBe('kimi-code');
    expect(detectKimiCliFlavor('/Users/me/.local/bin/kimi-cli')).toBe('legacy');
    expect(detectKimiCliFlavor('/Users/me/.local/bin/kimi-legacy')).toBe('legacy');
  });

  it('uses modern Kimi Code prompt-mode flags without legacy-only options', () => {
    const spec = buildKimiLaunchSpec({
      ...BASE,
      command: '/Users/me/.kimi-code/bin/kimi',
      permissionMode: 'yolo',
      sessionId: 'session_123',
    });
    expect(spec.args).not.toContain('--print');
    expect(spec.args).not.toContain('--agent');
    expect(spec.args).not.toContain('--thinking');
    expect(spec.args).not.toContain('--yolo');
    expect(spec.args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '-S', 'session_123', '-p', 'hi']));
  });

  it('keeps legacy kimi-cli print-mode flags', () => {
    const spec = buildKimiLaunchSpec(BASE);
    expect(spec.args).toEqual(expect.arrayContaining([
      '--print',
      '--output-format',
      'stream-json',
      '--thinking',
      '--agent',
      'default',
      '--add-dir',
      '/vault',
      '--work-dir',
      '/vault',
      '-p',
      'hi',
    ]));
  });
});
