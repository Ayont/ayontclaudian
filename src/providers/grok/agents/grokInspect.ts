import type { AgentDefinition } from '../../../core/types/agent';

/**
 * Reading Grok's own view of this directory.
 *
 * `grok inspect --json` reports exactly what the CLI discovered for a working
 * directory: version and channel, whether the project is trusted, and the
 * agents, MCP servers, plugins and skills it will actually use. Asking the CLI
 * beats reimplementing that search — Grok merges builtin definitions with
 * `~/.claude/agents`, project scope and every enabled plugin, and it applies
 * harness-compatibility settings on top. Any reimplementation would drift.
 *
 * It also costs nothing: `inspect` reads configuration and never calls the API.
 *
 * Verified against grok 1.0.34 (stable).
 */

/** How Grok found an agent, mapped onto Claudian's scope vocabulary. */
type AgentScope = AgentDefinition['source'];

export interface GrokAgentEntry {
  name: string;
  description: string;
  source: AgentScope;
  /** Definition file, absent for builtin agents. */
  filePath?: string;
  /** Owning plugin, when the agent came from one. */
  pluginName?: string;
}

export interface GrokMcpServerEntry {
  name: string;
  transport: string;
  enabled: boolean;
}

export interface GrokPluginEntry {
  name: string;
  enabled: boolean;
  agentCount: number;
}

export interface GrokEnvironment {
  version: string | null;
  channel: string | null;
  cwd: string | null;
  projectRoot: string | null;
  /**
   * Grok asks before letting an untrusted project's hooks and MCP servers run.
   * A vault that is not trusted therefore behaves differently, which is worth
   * showing rather than letting the user discover it mid-turn.
   */
  projectTrusted: boolean;
  agents: GrokAgentEntry[];
  mcpServers: GrokMcpServerEntry[];
  plugins: GrokPluginEntry[];
  skillCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Grok's scope names differ from Claudian's: it calls a `~/.claude/agents`
 * definition "user" where Claudian says "global", and "project" where Claudian
 * says "vault".
 */
function toAgentScope(type: string | null): AgentScope {
  switch (type) {
    case 'builtin':
      return 'builtin';
    case 'plugin':
      return 'plugin';
    case 'project':
    case 'local':
      return 'vault';
    default:
      return 'global';
  }
}

function parseAgent(value: unknown): GrokAgentEntry | null {
  const record = asRecord(value);
  const name = asTrimmedString(record?.name);
  // An agent with no name is unusable: `--agent <unknown>` is accepted by the
  // CLI and then silently ignored, so a bad entry would look like it worked.
  if (!record || !name) return null;

  const source = asRecord(record.source);
  const pluginName = asTrimmedString(source?.plugin) ?? undefined;

  return {
    description: asTrimmedString(record.description) ?? '',
    filePath: asTrimmedString(source?.path) ?? undefined,
    name,
    source: toAgentScope(asTrimmedString(source?.type)),
    ...(pluginName ? { pluginName } : {}),
  };
}

function parseMcpServer(value: unknown): GrokMcpServerEntry | null {
  const record = asRecord(value);
  const name = asTrimmedString(record?.name);
  if (!record || !name) return null;

  return {
    enabled: asTrimmedString(record.compatibilityStatus) !== 'disabled',
    name,
    transport: asTrimmedString(record.transport) ?? 'stdio',
  };
}

function parsePlugin(value: unknown): GrokPluginEntry | null {
  const record = asRecord(value);
  const name = asTrimmedString(record?.name);
  if (!record || !name) return null;

  const provides = asRecord(record.provides);
  const agentCount = typeof provides?.agents === 'number' ? provides.agents : 0;

  return { agentCount, enabled: record.enabled !== false, name };
}

/**
 * Normalizes a `grok inspect --json` payload.
 *
 * Optional status metadata can degrade, but the agents array is mandatory:
 * an error object or incompatible schema must not replace verified discovery.
 */
export function parseGrokEnvironment(payload: unknown): GrokEnvironment {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.agents) || record.error != null) {
    throw new Error('Grok hat keine gültige Bot-Liste zurückgegeben.');
  }

  return {
    agents: asArray(record.agents).map(parseAgent).filter((agent): agent is GrokAgentEntry => agent !== null),
    channel: asTrimmedString(record.channel),
    cwd: asTrimmedString(record.cwd),
    mcpServers: asArray(record.mcpServers)
      .map(parseMcpServer)
      .filter((server): server is GrokMcpServerEntry => server !== null),
    plugins: asArray(record.plugins)
      .map(parsePlugin)
      .filter((plugin): plugin is GrokPluginEntry => plugin !== null),
    projectRoot: asTrimmedString(record.projectRoot),
    projectTrusted: record.projectTrusted === true,
    skillCount: asArray(record.skills).length,
    version: asTrimmedString(record.grokVersion),
  };
}
