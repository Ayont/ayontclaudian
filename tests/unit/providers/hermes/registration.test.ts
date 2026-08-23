import { CLI_INSTALL_CATALOG, getInstallMethods } from '@/core/install/cliInstallCatalog';
import { HERMES_PROVIDER_CAPABILITIES } from '@/providers/hermes/capabilities';
import { hermesProviderRegistration } from '@/providers/hermes/registration';
import { HERMES_PROVIDER_ID } from '@/providers/hermes/settings';

describe('Hermes capabilities', () => {
  it('claims only what `hermes acp` actually implements', () => {
    expect(HERMES_PROVIDER_CAPABILITIES).toMatchObject({
      providerId: HERMES_PROVIDER_ID,
      // `initialize` advertises loadSession + image prompts; `session/update`
      // carries available_commands_update and usage_update.
      supportsImageAttachments: true,
      supportsNativeHistory: true,
      supportsPersistentRuntime: true,
      supportsProviderCommands: true,
      // Neither a plan mode nor a reasoning knob exists on the ACP surface.
      reasoningControl: 'none',
      supportsPlanMode: false,
      supportsRewind: false,
    });
  });
});

describe('hermesProviderRegistration', () => {
  it('ships disabled so it stays out of the model picker until switched on', () => {
    expect(hermesProviderRegistration.isEnabled({})).toBe(false);
    expect(hermesProviderRegistration.isEnabled({
      providerConfigs: { hermes: { enabled: true } },
    })).toBe(true);
  });

  it('exposes the metadata the app-level surfaces read', () => {
    expect(hermesProviderRegistration.displayName).toBe('Hermes');
    expect(hermesProviderRegistration.capabilities).toBe(HERMES_PROVIDER_CAPABILITIES);
    expect(hermesProviderRegistration.defaultConfig).toMatchObject({ enabled: false });
    expect(hermesProviderRegistration.brandColor).toBe('#8B5CF6');
  });

  it('scopes HERMES_* environment variables to this provider', () => {
    const patterns = hermesProviderRegistration.environmentKeyPatterns ?? [];

    expect(patterns.some((pattern) => pattern.test('HERMES_HOME'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('OPENCODE_DB'))).toBe(false);
  });
});

describe('Hermes CLI install catalog', () => {
  it('detects the `hermes` binary and offers the official installer', () => {
    expect(CLI_INSTALL_CATALOG.hermes).toMatchObject({
      binary: 'hermes',
      displayName: 'Hermes Agent',
      id: 'hermes',
    });
    expect(getInstallMethods('hermes', 'darwin')[0].command)
      .toContain('hermes-agent.nousresearch.com/install.sh');
    expect(getInstallMethods('hermes', 'win32')[0].command)
      .toContain('hermes-agent.nousresearch.com/install.ps1');
  });
});
