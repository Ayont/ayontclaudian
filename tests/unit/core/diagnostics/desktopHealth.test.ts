import { checkProviderHealth, clearHealthCheckCache, ensureProviderHealthy } from '@/core/diagnostics/providerHealthCheck';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { desktopAppPath } from '@/providers/desktopBridge/helper';

jest.mock('@/providers/desktopBridge/helper', () => ({ desktopAppPath: jest.fn() }));

describe('desktop consumer-chat health', () => {
  afterEach(() => { jest.restoreAllMocks(); clearHealthCheckCache(); });
  it.each(['grok-bot', 'perplexity-chat'])('checks app prerequisites without spawning an app directory for %s', async id => {
    jest.spyOn(ProviderRegistry, 'getRegisteredProviderIds').mockReturnValue([id]);
    jest.spyOn(ProviderRegistry, 'isEnabled').mockReturnValue(true);
    jest.spyOn(ProviderRegistry, 'getProviderDisplayName').mockReturnValue(id);
    jest.mocked(desktopAppPath).mockReturnValue('/Applications/Test.app');
    expect(await ensureProviderHealthy(id, {})).toEqual({ ok: true, providerId: id });
    expect(await checkProviderHealth(id, {})).toMatchObject({ ok: true, detail: expect.stringContaining('Bedienungshilfen') });
    jest.mocked(desktopAppPath).mockReturnValue(null);
    expect(await ensureProviderHealthy(id, {})).toMatchObject({ ok: false });
    jest.mocked(desktopAppPath).mockReturnValue('/Applications/Test.app');
    jest.spyOn(ProviderRegistry, 'isEnabled').mockReturnValue(false);
    expect(await ensureProviderHealthy(id, {})).toMatchObject({ ok: false });
  });
});
