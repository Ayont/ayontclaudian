import { clineProviderRegistration } from '@/providers/cline/registration';
import { DEFAULT_CLINE_PROVIDER_SETTINGS } from '@/providers/cline/settings';
import { opencodeProviderRegistration } from '@/providers/opencode/registration';

describe('clineProviderRegistration', () => {
  it('registers a disabled-by-default ACP provider after OpenCode', () => {
    expect(clineProviderRegistration.displayName).toBe('Cline');
    expect(clineProviderRegistration.blankTabOrder).toBeGreaterThan(
      opencodeProviderRegistration.blankTabOrder,
    );
    expect(clineProviderRegistration.isEnabled({})).toBe(false);
    expect(DEFAULT_CLINE_PROVIDER_SETTINGS.enabled).toBe(false);
    expect(clineProviderRegistration.capabilities.supportsPlanMode).toBe(true);
    expect(clineProviderRegistration.capabilities.reasoningControl).toBe('effort');
  });
});
