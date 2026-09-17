import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';

/**
 * `initializeAll` runs inside `onload()`, which Obsidian awaits — so it is
 * literally added to app startup. Two properties matter there:
 *
 *  - one broken provider must not take the whole plugin down with it (a
 *    rejection here means no registerView, no ribbon, no commands at all), and
 *  - a provider the user has switched OFF must not make them wait for its
 *    vault scans before the window becomes interactive.
 */
describe('ProviderWorkspaceRegistry.initializeAll', () => {
  const originalRegistrations = (ProviderWorkspaceRegistry as unknown as {
    registrations: Record<string, unknown>;
  }).registrations;

  function setRegistrations(registrations: Record<string, unknown>): void {
    (ProviderWorkspaceRegistry as unknown as { registrations: unknown }).registrations = registrations;
    (ProviderWorkspaceRegistry as unknown as { services: unknown }).services = {};
  }

  const plugin = {
    settings: {},
    storage: { getAdapter: () => ({}) },
  } as never;

  afterEach(() => {
    setRegistrations(originalRegistrations as Record<string, unknown>);
    jest.restoreAllMocks();
  });

  it('does not let one failing provider abort the whole startup', async () => {
    jest.spyOn(ProviderRegistry, 'isEnabled').mockReturnValue(true);
    const healthy = jest.fn(async () => ({ commandCatalog: null }));
    setRegistrations({
      broken: { initialize: async () => { throw new Error('vault scan exploded'); } },
      healthy: { initialize: healthy },
    });

    await expect(ProviderWorkspaceRegistry.initializeAll(plugin)).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalled();
    expect(ProviderWorkspaceRegistry.getServices('healthy')).toBeTruthy();
    expect(ProviderWorkspaceRegistry.getServices('broken')).toBeFalsy();
  });

  it('does not block startup on a provider the user disabled', async () => {
    jest.spyOn(ProviderRegistry, 'isEnabled')
      .mockImplementation((providerId) => providerId === 'enabled');

    let releaseDisabled: (() => void) | null = null;
    const disabledDone = new Promise<void>((resolve) => { releaseDisabled = resolve; });
    const disabled = jest.fn(async () => {
      await disabledDone;
      return { commandCatalog: null };
    });

    setRegistrations({
      enabled: { initialize: async () => ({ commandCatalog: null }) },
      disabled: { initialize: disabled },
    });

    // Resolves even though the disabled provider is still stuck.
    await expect(ProviderWorkspaceRegistry.initializeAll(plugin)).resolves.toBeUndefined();
    expect(ProviderWorkspaceRegistry.getServices('enabled')).toBeTruthy();

    releaseDisabled!();
    await Promise.resolve();
  });

  it('still initializes a disabled provider, so its settings tab works', async () => {
    jest.spyOn(ProviderRegistry, 'isEnabled').mockReturnValue(false);
    const disabled = jest.fn(async () => ({ commandCatalog: null }));
    setRegistrations({ disabled: { initialize: disabled } });

    await ProviderWorkspaceRegistry.initializeAll(plugin);
    await ProviderWorkspaceRegistry.whenFullyInitialized();

    expect(disabled).toHaveBeenCalled();
    expect(ProviderWorkspaceRegistry.getServices('disabled')).toBeTruthy();
  });
});
