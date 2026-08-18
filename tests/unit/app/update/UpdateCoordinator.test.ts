import { UpdateCoordinator } from '@/app/update/UpdateCoordinator';

describe('UpdateCoordinator.offerProviderUpdates', () => {
  it('offers a CLI update even when the latest version is unknown', () => {
    const coordinator = new UpdateCoordinator();
    coordinator.offerProviderUpdates([
      {
        providerId: 'vibe',
        displayName: 'Vibe (Mistral)',
        currentVersion: '2.20.0',
        latestVersion: null,
        updateAvailable: false,
        updateCommand: 'uv tool upgrade mistral-vibe',
      },
    ]);
    const item = coordinator.getState().items[0];
    expect(item).toEqual(
      expect.objectContaining({
        id: 'cli:vibe',
        displayName: 'Vibe (Mistral)',
        currentVersion: '2.20.0',
        latestVersion: 'neueste',
        command: 'uv tool upgrade mistral-vibe',
        status: 'available',
      }),
    );
  });

  it('skips a provider with no update command', () => {
    const coordinator = new UpdateCoordinator();
    coordinator.offerProviderUpdates([
      {
        providerId: 'pi',
        displayName: 'Pi',
        currentVersion: '0.79.9',
        latestVersion: null,
        updateAvailable: false,
        updateCommand: null,
      },
    ]);
    expect(coordinator.getState().items).toEqual([]);
  });
});
