import { ProviderWorkspaceRegistry } from '../../core/providers/ProviderWorkspaceRegistry';
import { getMcpServerType, type ManagedMcpServer } from '../../core/types';
import type { AcpMcpCapabilities, AcpMcpServer } from './types';

function toPairs(record: Record<string, string> | undefined): Array<{ name: string; value: string }> {
  return Object.entries(record ?? {}).map(([name, value]) => ({ name, value }));
}

/**
 * Claudian's MCP servers in ACP shape, limited to what the agent can reach:
 * every ACP agent must speak stdio, http/sse only when `initialize` advertised
 * them in `mcpCapabilities`.
 *
 * Only always-on servers qualify. An ACP session's servers are fixed at
 * `session/new` / `session/load`, so a context-saving server (which Claude
 * attaches per turn on @-mention) has no per-turn equivalent; and ACP cannot
 * block single tools, so a server with disabled tools is withheld rather than
 * handed over with those tools live.
 */
export function toAcpMcpServers(
  servers: readonly ManagedMcpServer[],
  capabilities: AcpMcpCapabilities | null | undefined,
): AcpMcpServer[] {
  const result: AcpMcpServer[] = [];
  for (const server of servers) {
    if (!server.enabled || server.contextSaving || (server.disabledTools?.length ?? 0) > 0) continue;
    const { config } = server;
    const type = getMcpServerType(config);
    if (type === 'stdio' && 'command' in config) {
      result.push({ name: server.name, command: config.command, args: [...(config.args ?? [])], env: toPairs(config.env) });
    } else if ((type === 'http' || type === 'sse') && capabilities?.[type] === true && 'url' in config) {
      result.push({ type, name: server.name, url: config.url, headers: toPairs(config.headers) });
    }
  }
  return result;
}

/** `.claude/mcp.json` is Claudian's one managed server list; the Claude workspace owns it. */
export function resolveClaudianAcpMcpServers(
  capabilities: AcpMcpCapabilities | null | undefined,
): AcpMcpServer[] {
  const manager = ProviderWorkspaceRegistry.getMcpServerManager('claude');
  return manager ? toAcpMcpServers(manager.getServers(), capabilities) : [];
}

/**
 * Opens an ACP session with Claudian's servers, and without them when the
 * agent refuses: one broken server in `.claude/mcp.json` must not make the
 * whole provider unusable. `onDropped` reports that the servers were left out.
 */
export async function openWithMcpFallback<T>(
  servers: AcpMcpServer[],
  open: (mcpServers: AcpMcpServer[]) => Promise<T>,
  onDropped?: (error: unknown) => void,
): Promise<T> {
  try {
    return await open(servers);
  } catch (error) {
    if (servers.length === 0) throw error;
    const result = await open([]);
    onDropped?.(error);
    return result;
  }
}
