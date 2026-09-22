import { GrokAgentCatalog } from '@/providers/grok/agents/GrokAgentCatalog';

const SAMPLE = JSON.stringify({
  agents: [
    { name: 'general-purpose', description: 'General purpose agent.', source: { type: 'builtin' } },
    { name: 'explore', description: 'Read-only codebase exploration.', source: { type: 'builtin' } },
    { name: 'seo-content', description: 'Content quality reviewer.', source: { type: 'user', path: '/u/seo.md' } },
  ],
  channel: 'stable',
  cwd: '/vault',
  grokVersion: '1.0.34',
  projectTrusted: false,
});

describe('GrokAgentCatalog', () => {
  const makeCatalog = (run: jest.Mock) => new GrokAgentCatalog({ runInspect: run });

  it('starts empty, so a mention dropdown never shows agents it has not verified', () => {
    const catalog = makeCatalog(jest.fn());

    expect(catalog.searchAgents('')).toEqual([]);
    expect(catalog.getEnvironment()).toBeNull();
  });

  it('exposes the agents the CLI reported', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue(SAMPLE));

    await catalog.refresh();

    expect(catalog.searchAgents('').map((agent) => agent.name)).toEqual([
      'general-purpose',
      'explore',
      'seo-content',
    ]);
    expect(catalog.getEnvironment()?.version).toBe('1.0.34');
  });

  it('matches on name and description, case-insensitively', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue(SAMPLE));
    await catalog.refresh();

    expect(catalog.searchAgents('EXPLO').map((agent) => agent.name)).toEqual(['explore']);
    expect(catalog.searchAgents('quality').map((agent) => agent.name)).toEqual(['seo-content']);
  });

  it('carries the scope through so the dropdown can label where an agent came from', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue(SAMPLE));
    await catalog.refresh();

    const [builtin, , user] = catalog.searchAgents('');
    expect(builtin.source).toBe('builtin');
    expect(user.source).toBe('global');
  });

  it('answers whether a name is real — the CLI accepts --agent <unknown> and ignores it', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue(SAMPLE));
    await catalog.refresh();

    expect(catalog.hasAgent('explore')).toBe(true);
    expect(catalog.hasAgent('Explore')).toBe(true);
    expect(catalog.hasAgent('nope')).toBe(false);
  });

  it('cannot answer hasAgent before it has loaded, and says so', () => {
    const catalog = makeCatalog(jest.fn());

    expect(catalog.hasAgent('explore')).toBe(false);
    expect(catalog.isLoaded()).toBe(false);
  });

  it('keeps the previous catalog when a refresh fails, and records the error', async () => {
    const run = jest.fn().mockResolvedValueOnce(SAMPLE).mockRejectedValueOnce(new Error('grok not found'));
    const catalog = makeCatalog(run);
    await catalog.refresh();

    await catalog.refresh();

    expect(catalog.searchAgents('')).toHaveLength(3);
    expect(catalog.getLastError()).toContain('grok not found');
  });

  it('records an error for output that is not JSON rather than throwing at the caller', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue('command not found: grok'));

    await catalog.refresh();

    expect(catalog.getLastError()).toBeTruthy();
    expect(catalog.isLoaded()).toBe(false);
  });

  it('collapses concurrent refreshes into one CLI call', async () => {
    const run = jest.fn().mockResolvedValue(SAMPLE);
    const catalog = makeCatalog(run);

    await Promise.all([catalog.refresh(), catalog.refresh(), catalog.refresh()]);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let consumers mutate the verified discovery snapshot', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue(SAMPLE));
    await catalog.refresh();
    catalog.getAgents()[0].name = 'invented';
    catalog.getEnvironment()!.agents.push({ name: 'fake', description: '', source: 'builtin' });
    expect(catalog.resolveAgentName('general-purpose')).toBe('general-purpose');
    expect(catalog.hasAgent('fake')).toBe(false);
  });

  it('does not expose malformed CLI output through JSON parser errors', async () => {
    const catalog = makeCatalog(jest.fn().mockResolvedValue('secret-output-not-json'));
    await catalog.refresh();
    expect(catalog.getLastError()).toBe('Grok hat keine gültige Bot-Liste zurückgegeben.');
  });

  it('clears a stale error once a refresh succeeds again', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(SAMPLE);
    const catalog = makeCatalog(run);
    await catalog.refresh();
    expect(catalog.getLastError()).toBeTruthy();

    await catalog.refresh();

    expect(catalog.getLastError()).toBeNull();
    expect(catalog.isLoaded()).toBe(true);
  });
});
