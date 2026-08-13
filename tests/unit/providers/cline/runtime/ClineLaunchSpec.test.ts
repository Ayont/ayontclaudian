import { buildClineLaunchSpec, formatClinePromptArg } from '@/providers/cline/runtime/ClineLaunchSpec';
import { isClineNativeSessionId } from '@/providers/cline/types';

describe('formatClinePromptArg', () => {
  it('adds a trailing space so Cline 3.0.31+ accepts one-word prompts', () => {
    expect(formatClinePromptArg('hi')).toBe('hi ');
    expect(formatClinePromptArg('test#')).toBe('test# ');
  });

  it('leaves already-quoted multi-word prompts unchanged', () => {
    expect(formatClinePromptArg('Name this chat')).toBe('Name this chat');
  });
});

describe('isClineNativeSessionId', () => {
  it('accepts Cline CLI session ids and rejects foreign ones', () => {
    expect(isClineNativeSessionId('1786522352621_1rqet')).toBe(true);
    expect(isClineNativeSessionId('codex-rollout-abc')).toBe(false);
    expect(isClineNativeSessionId('ses_01ABC')).toBe(false);
  });
});

describe('buildClineLaunchSpec', () => {
  it('builds a streaming --json turn with ClinePass model and plan', () => {
    const spec = buildClineLaunchSpec({
      command: '/usr/local/bin/cline',
      cwd: '/vault',
      env: {},
      mode: 'print',
      model: 'cline-pass/kimi-k3',
      permissionMode: 'plan',
      prompt: 'hi',
      sessionId: '1786522352621_1rqet',
      thinking: 'high',
    });
    expect(spec.args).toEqual([
      '--yolo',
      '--json',
      '-P', 'cline-pass',
      '-m', 'cline-pass/kimi-k3',
      '--thinking', 'high',
      '-c', '/vault',
      '--plan',
      '--id', '1786522352621_1rqet',
      'hi ',
    ]);
  });

  it('omits --id for a foreign session so Cline starts clean', () => {
    const spec = buildClineLaunchSpec({
      command: 'cline',
      cwd: '/vault',
      env: {},
      mode: 'print',
      model: 'cline-pass/glm-5.2',
      permissionMode: 'yolo',
      prompt: 'hi',
      sessionId: 'codex-foreign-session',
      thinking: 'medium',
    });
    expect(spec.args).not.toContain('--id');
    expect(spec.args).toContain('hi ');
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
