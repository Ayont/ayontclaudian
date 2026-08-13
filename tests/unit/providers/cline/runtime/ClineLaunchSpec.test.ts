import { buildClineLaunchSpec } from '@/providers/cline/runtime/ClineLaunchSpec';

describe('buildClineLaunchSpec', () => {
  it('starts ACP with ClinePass model, thinking, and yolo auto-approve', () => {
    const spec = buildClineLaunchSpec({
      command: '/usr/local/bin/cline',
      cwd: '/vault',
      env: {},
      mode: 'acp',
      model: 'cline-pass/kimi-k3',
      permissionMode: 'yolo',
      thinking: 'xhigh',
    });
    expect(spec.args).toEqual([
      '--acp',
      '-P', 'cline-pass',
      '-m', 'cline-pass/kimi-k3',
      '--thinking', 'xhigh',
      '-c', '/vault',
      '--auto-approve', 'true',
    ]);
  });

  it('adds --plan in plan mode and turns auto-approve off in safe mode', () => {
    const plan = buildClineLaunchSpec({
      command: 'cline',
      cwd: '/vault',
      env: {},
      mode: 'acp',
      model: 'cline-pass/glm-5.2',
      permissionMode: 'plan',
      thinking: 'high',
    });
    expect(plan.args).toContain('--plan');
    expect(plan.args).toContain('--auto-approve');

    const safe = buildClineLaunchSpec({
      command: 'cline',
      cwd: '/vault',
      env: {},
      mode: 'acp',
      model: 'cline-pass/glm-5.2',
      permissionMode: 'normal',
      thinking: 'medium',
    });
    expect(safe.args).toEqual(expect.arrayContaining(['--auto-approve', 'false']));
    expect(safe.args).not.toContain('--plan');
  });

  it('builds a one-shot --json aux turn without resume', () => {
    const spec = buildClineLaunchSpec({
      command: 'cline',
      cwd: '/vault',
      env: {},
      mode: 'print',
      model: 'cline-pass/deepseek-v4-flash',
      permissionMode: 'yolo',
      prompt: 'Name this chat',
      thinking: 'none',
    });
    expect(spec.args).toEqual([
      '--yolo',
      '--json',
      '-P', 'cline-pass',
      '-m', 'cline-pass/deepseek-v4-flash',
      '--thinking', 'none',
      '-c', '/vault',
      'Name this chat',
    ]);
  });
});
