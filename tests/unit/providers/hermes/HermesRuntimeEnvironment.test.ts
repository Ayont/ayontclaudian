import { buildHermesRuntimeEnv } from '@/providers/hermes/runtime/HermesRuntimeEnvironment';

function createSettings(config: Record<string, unknown> = {}): Record<string, unknown> {
  return { providerConfigs: { hermes: config } };
}

describe('buildHermesRuntimeEnv', () => {
  it('leaves the escape hatches unset by default', () => {
    const env = buildHermesRuntimeEnv(createSettings(), '/usr/local/bin/hermes');

    expect(env.HERMES_YOLO_MODE).toBeUndefined();
    expect(env.HERMES_ACCEPT_HOOKS).toBeUndefined();
  });

  // `tools/approval.py` freezes HERMES_YOLO_MODE at import time, so it has to
  // be in the child's environment rather than toggled over the wire later.
  it('exports HERMES_YOLO_MODE when approvals are bypassed', () => {
    const env = buildHermesRuntimeEnv(createSettings({ yoloMode: true }), '/usr/local/bin/hermes');

    expect(env.HERMES_YOLO_MODE).toBe('1');
  });

  it('exports HERMES_ACCEPT_HOOKS when hooks are auto-approved', () => {
    const env = buildHermesRuntimeEnv(createSettings({ acceptHooks: true }), '/usr/local/bin/hermes');

    expect(env.HERMES_ACCEPT_HOOKS).toBe('1');
  });

  it('passes user-configured variables through', () => {
    const env = buildHermesRuntimeEnv(
      createSettings({ environmentVariables: 'HERMES_HOME=/srv/hermes-work\nHERMES_PROFILE=work' }),
      '/usr/local/bin/hermes',
    );

    expect(env.HERMES_HOME).toBe('/srv/hermes-work');
    expect(env.HERMES_PROFILE).toBe('work');
  });

  it('puts a user-configured PATH entry ahead of the inherited one', () => {
    const env = buildHermesRuntimeEnv(
      createSettings({ environmentVariables: 'PATH=/opt/hermes/bin' }),
      '/usr/local/bin/hermes',
    );

    expect(env.PATH?.startsWith('/opt/hermes/bin')).toBe(true);
  });
});
