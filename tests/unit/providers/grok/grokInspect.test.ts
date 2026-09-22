import { parseGrokEnvironment } from '@/providers/grok/agents/grokInspect';

/**
 * Shapes taken verbatim from `grok inspect --json` (grok 1.0.34, stable) run in
 * the user's vault. `grok inspect` is the CLI's own discovery — asking it beats
 * reimplementing the search across builtin, user, project and plugin scopes,
 * and it costs no API call.
 */
const REAL_SAMPLE = {
  grokVersion: '1.0.34',
  channel: 'stable',
  cwd: '/Users/ayont/Documents/Obsidian Vault',
  projectRoot: null,
  projectTrusted: false,
  agents: [
    { name: 'general-purpose', description: 'General purpose agent for multi-step tasks.', source: { type: 'builtin' } },
    { name: 'explore', description: 'Fast, read-only agent specialized for codebase exploration.', source: { type: 'builtin' } },
    {
      name: 'seo-content',
      description: 'Content quality reviewer.',
      source: { type: 'user', path: '/Users/ayont/.claude/agents/seo-content.md' },
    },
  ],
  mcpServers: [
    {
      name: 'hunari-motion-mcp',
      transport: 'stdio',
      target: '/Users/ayont/.local/bin/hunari-motion-mcp',
      compatibilityStatus: 'enabled',
      vendor: 'claude',
    },
    { name: 'disabled-one', transport: 'stdio', compatibilityStatus: 'disabled' },
  ],
  plugins: [
    { name: 'ruflo-core', scope: 'user', enabled: true, provides: { skills: 5, agents: 1 } },
    { name: 'off-plugin', scope: 'user', enabled: false, provides: { skills: 1, agents: 0 } },
  ],
  skills: [{ name: 'animate' }, { name: 'tdd' }],
};

describe('parseGrokEnvironment', () => {
  it('reads the connection facts the status panel shows', () => {
    const env = parseGrokEnvironment(REAL_SAMPLE);

    expect(env.version).toBe('1.0.34');
    expect(env.channel).toBe('stable');
    expect(env.cwd).toBe('/Users/ayont/Documents/Obsidian Vault');
    expect(env.projectTrusted).toBe(false);
  });

  it('keeps each agent with the scope it came from', () => {
    const env = parseGrokEnvironment(REAL_SAMPLE);

    expect(env.agents).toHaveLength(3);
    expect(env.agents[0]).toEqual({
      description: 'General purpose agent for multi-step tasks.',
      filePath: undefined,
      name: 'general-purpose',
      source: 'builtin',
    });
    expect(env.agents[2]).toEqual({
      description: 'Content quality reviewer.',
      filePath: '/Users/ayont/.claude/agents/seo-content.md',
      name: 'seo-content',
      source: 'global',
    });
  });

  it('counts only what is actually active', () => {
    const env = parseGrokEnvironment(REAL_SAMPLE);

    expect(env.mcpServers.filter((server) => server.enabled)).toHaveLength(1);
    expect(env.plugins.filter((plugin) => plugin.enabled)).toHaveLength(1);
    expect(env.skillCount).toBe(2);
  });

  it('survives optional metadata fields being dropped by a newer CLI', () => {
    const env = parseGrokEnvironment({ grokVersion: '2.0.0', agents: [] });

    expect(env.version).toBe('2.0.0');
    expect(env.agents).toEqual([]);
    expect(env.mcpServers).toEqual([]);
    expect(env.channel).toBeNull();
  });

  it.each([{}, { error: 'denied' }, { agents: null }, { agents: {} }, { agents: [], error: 'failed' }])(
    'rejects a missing or failed discovery report: %j', (payload) => {
      expect(() => parseGrokEnvironment(payload)).toThrow('Bot-Liste');
    },
  );

  it('rejects a non-object payload instead of inventing an environment', () => {
    expect(() => parseGrokEnvironment('nope')).toThrow();
    expect(() => parseGrokEnvironment(null)).toThrow();
  });

  it('skips agent entries with no usable name — an unknown --agent is silently ignored by the CLI', () => {
    const env = parseGrokEnvironment({
      agents: [{ description: 'no name' }, { name: '   ' }, { name: 'ok' }],
    });

    expect(env.agents.map((agent) => agent.name)).toEqual(['ok']);
  });
});
