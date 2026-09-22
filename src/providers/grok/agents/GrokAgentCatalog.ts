import type { AgentMentionProvider } from '../../../core/providers/types';
import {
  type GrokAgentEntry,
  type GrokEnvironment,
  parseGrokEnvironment,
} from './grokInspect';

/**
 * The set of Grok agents ("Grok bots") available in this vault, plus the
 * connection facts that explain why.
 *
 * Grok resolves agents from four scopes at once — its own builtins, the
 * `~/.claude/agents` directory it reads through harness compatibility, project
 * scope, and every enabled plugin — and `grok inspect --json` is the CLI
 * telling us the result. That is the only source that cannot drift from what a
 * turn will actually do.
 *
 * Loading is explicit. The catalog stays empty until a refresh succeeds, so the
 * mention dropdown never offers a bot that was never confirmed to exist. This
 * matters more than it looks: `grok --agent <unknown>` is accepted and then
 * silently ignored, so an invented name produces an ordinary answer from the
 * default agent and nothing tells the user their bot was skipped.
 */

export interface GrokAgentCatalogOptions {
  /** Runs `grok inspect --json` and resolves its stdout. */
  runInspect: () => Promise<string>;
}

export class GrokAgentCatalog implements AgentMentionProvider {
  private environment: GrokEnvironment | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly options: GrokAgentCatalogOptions) {}

  /** True once a refresh has produced a usable report. */
  isLoaded(): boolean {
    return this.environment !== null;
  }

  getEnvironment(): GrokEnvironment | null {
    if (!this.environment) return null;
    return {
      ...this.environment,
      agents: this.getAgents(),
      mcpServers: this.environment.mcpServers.map((server) => ({ ...server })),
      plugins: this.environment.plugins.map((plugin) => ({ ...plugin })),
    };
  }

  /** Message from the last failed refresh, cleared by the next success. */
  getLastError(): string | null {
    return this.lastError;
  }

  getAgents(): GrokAgentEntry[] {
    return this.environment?.agents.map((agent) => ({ ...agent })) ?? [];
  }

  /**
   * Whether `--agent <name>` would hit a real definition. Case-insensitive,
   * because the mention UI and hand-typed names differ in casing.
   */
  hasAgent(name: string): boolean {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return false;
    return this.getAgents().some((agent) => agent.name.toLowerCase() === wanted);
  }

  /** Canonical spelling for a name, so the CLI gets the exact definition id. */
  resolveAgentName(name: string): string | null {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;
    return this.getAgents().find((agent) => agent.name.toLowerCase() === wanted)?.name ?? null;
  }

  searchAgents(query: string): Array<{
    id: string;
    name: string;
    description?: string;
    source: GrokAgentEntry['source'];
  }> {
    const needle = query.trim().toLowerCase();
    return this.getAgents()
      .filter((agent) => !needle
        || agent.name.toLowerCase().includes(needle)
        || agent.description.toLowerCase().includes(needle))
      .map((agent) => ({
        description: agent.description || undefined,
        id: agent.name,
        name: agent.name,
        source: agent.source,
      }));
  }

  /**
   * Re-reads the CLI's report. Concurrent calls share one process: the tab
   * warmup, the settings tab and a mention dropdown can all ask at once.
   *
   * A failure never throws and never empties a catalog that already loaded —
   * a transient spawn error must not make every bot disappear mid-session.
   */
  async refresh(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
      return;
    }

    this.inFlight = this.load().finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async load(): Promise<void> {
    try {
      const stdout = await this.options.runInspect();
      this.environment = parseGrokEnvironment(JSON.parse(stdout) as unknown);
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof SyntaxError
        ? 'Grok hat keine gültige Bot-Liste zurückgegeben.'
        : error instanceof Error ? error.message : 'Die Grok-Bot-Abfrage ist fehlgeschlagen.';
    }
  }
}
