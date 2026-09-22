import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { GrokAgentCatalog } from '@/providers/grok/agents/GrokAgentCatalog';
import { resolveGrokBotName } from '@/providers/grok/agents/resolveGrokBotName';

const CATALOG_JSON = JSON.stringify({
  agents: [
    { name: 'explore', description: 'Read-only exploration.', source: { type: 'builtin' } },
    { name: 'seo-content', description: 'Content reviewer.', source: { type: 'user' } },
  ],
});

describe('resolveGrokBotName', () => {
  afterEach(() => {
    ProviderWorkspaceRegistry.setServices('grok', undefined);
  });

  const installCatalog = (run = jest.fn().mockResolvedValue(CATALOG_JSON)) => {
    const catalog = new GrokAgentCatalog({ runInspect: run });
    ProviderWorkspaceRegistry.setServices('grok', { agentCatalog: catalog } as never);
    return catalog;
  };

  it('waits for cold discovery and coalesces concurrent bot resolutions', async () => {
    const run = jest.fn().mockResolvedValue(CATALOG_JSON);
    installCatalog(run);
    await expect(Promise.all([
      resolveGrokBotName('explore'), resolveGrokBotName('seo-content'),
    ])).resolves.toEqual(['explore', 'seo-content']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown bots instead of silently running the default agent', async () => {
    installCatalog();
    await expect(resolveGrokBotName('reviewer')).rejects.toThrow('nicht gefunden');
  });

  it('normalizes casing to the definition the CLI knows', async () => {
    installCatalog();
    await expect(resolveGrokBotName('  EXPLORE  ')).resolves.toBe('explore');
  });

  it('does not inspect when no bot is selected', async () => {
    const run = jest.fn();
    installCatalog(run);
    await expect(resolveGrokBotName('   ')).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects discovery errors', async () => {
    installCatalog(jest.fn().mockRejectedValue(new Error('Grok CLI wurde nicht gefunden.')));
    await expect(resolveGrokBotName('explore')).rejects.toThrow('Grok CLI');
  });

  it('revalidates a previously known bot rather than launching a deleted definition', async () => {
    const run = jest.fn().mockResolvedValueOnce(CATALOG_JSON).mockResolvedValueOnce('{"agents":[]}');
    installCatalog(run);
    await expect(resolveGrokBotName('explore')).resolves.toBe('explore');
    await expect(resolveGrokBotName('explore')).rejects.toThrow('nicht gefunden');
  });

  it('keeps stale entries for display but refuses to launch after refresh failure', async () => {
    const run = jest.fn().mockResolvedValueOnce(CATALOG_JSON).mockRejectedValueOnce(new Error('Abfrage fehlgeschlagen'));
    const catalog = installCatalog(run);
    await expect(resolveGrokBotName('explore')).resolves.toBe('explore');
    await expect(resolveGrokBotName('explore')).rejects.toThrow('Abfrage fehlgeschlagen');
    expect(catalog.hasAgent('explore')).toBe(true);
  });

  it('rejects when the provider workspace is not registered', async () => {
    await expect(resolveGrokBotName('explore')).rejects.toThrow('nicht bereit');
  });

  it('rejects when registered services predate the catalog', async () => {
    ProviderWorkspaceRegistry.setServices('grok', {} as never);
    await expect(resolveGrokBotName('explore')).rejects.toThrow('nicht bereit');
  });
});
