import type { BuildKimiLaunchSpecParams } from '@/providers/kimi/runtime/KimiLaunchSpec';
import { buildKimiLaunchSpec } from '@/providers/kimi/runtime/KimiLaunchSpec';

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

  it('permissionMode "yolo" passes --yolo and not --plan', () => {
    const spec = buildKimiLaunchSpec({ ...BASE, permissionMode: 'yolo' });
    expect(spec.args).toContain('--yolo');
    expect(spec.args).not.toContain('--plan');
  });

  it('permissionMode "plan" passes --plan and not --yolo', () => {
    const spec = buildKimiLaunchSpec({ ...BASE, permissionMode: 'plan' });
    expect(spec.args).toContain('--plan');
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
