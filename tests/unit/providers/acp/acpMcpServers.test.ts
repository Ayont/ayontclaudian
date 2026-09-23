import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import type { ManagedMcpServer } from '@/core/types';
import { resolveClaudianAcpMcpServers, toAcpMcpServers } from '@/providers/acp/acpMcpServers';

const server = (fields: Partial<ManagedMcpServer> & Pick<ManagedMcpServer, 'name' | 'config'>): ManagedMcpServer => ({
  enabled: true,
  contextSaving: false,
  ...fields,
});

const stdio = server({ name: 'files', config: { command: 'npx', args: ['-y', 'fs-server'], env: { ROOT: '/vault' } } });
const http = server({ name: 'docs', config: { type: 'http', url: 'https://mcp.example/docs', headers: { Authorization: 'Bearer t' } } });
const sse = server({ name: 'events', config: { type: 'sse', url: 'https://mcp.example/sse' } });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('toAcpMcpServers', () => {
  it('converts stdio servers to the ACP shape with name/value env pairs', () => {
    expect(toAcpMcpServers([stdio], null)).toEqual([
      { name: 'files', command: 'npx', args: ['-y', 'fs-server'], env: [{ name: 'ROOT', value: '/vault' }] },
    ]);
  });

  it('passes remote servers only over transports the agent advertised', () => {
    expect(toAcpMcpServers([stdio, http, sse], { http: true })).toEqual([
      expect.objectContaining({ name: 'files' }),
      { type: 'http', name: 'docs', url: 'https://mcp.example/docs', headers: [{ name: 'Authorization', value: 'Bearer t' }] },
    ]);
    // Hermes advertises no mcpCapabilities at all: stdio is the only baseline.
    expect(toAcpMcpServers([http, sse], undefined)).toEqual([]);
  });

  it('keeps disabled, context-saving and tool-restricted servers out', () => {
    const servers = [
      server({ name: 'off', enabled: false, config: { command: 'a' } }),
      server({ name: 'on-mention', contextSaving: true, config: { command: 'b' } }),
      server({ name: 'restricted', disabledTools: ['delete_all'], config: { command: 'c' } }),
    ];
    expect(toAcpMcpServers(servers, { http: true, sse: true })).toEqual([]);
  });
});

describe('resolveClaudianAcpMcpServers', () => {
  it('reads Claudian\'s managed server list', () => {
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager')
      .mockReturnValue({ getServers: () => [stdio, sse] } as never);

    expect(resolveClaudianAcpMcpServers({ sse: true }).map((entry) => entry.name)).toEqual(['files', 'events']);
    expect(ProviderWorkspaceRegistry.getMcpServerManager).toHaveBeenCalledWith('claude');
  });

  it('passes nothing when no server list is loaded', () => {
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager').mockReturnValue(null);

    expect(resolveClaudianAcpMcpServers({ http: true })).toEqual([]);
  });
});

describe('openWithMcpFallback', () => {
  it('opens the session without the servers when the agent refuses them', async () => {
    const { openWithMcpFallback } = await import('@/providers/acp/acpMcpServers');
    const open = jest.fn()
      .mockRejectedValueOnce(new Error('spawn broken-mcp ENOENT'))
      .mockResolvedValueOnce({ sessionId: 's1' });
    const onDropped = jest.fn();
    const servers = [{ name: 'broken', command: 'broken-mcp', args: [], env: [] }];

    await expect(openWithMcpFallback(servers, open, onDropped)).resolves.toEqual({ sessionId: 's1' });

    expect(open).toHaveBeenNthCalledWith(1, servers);
    expect(open).toHaveBeenNthCalledWith(2, []);
    expect(onDropped).toHaveBeenCalled();
  });

  it('rethrows when there were no servers to blame', async () => {
    const { openWithMcpFallback } = await import('@/providers/acp/acpMcpServers');
    const open = jest.fn().mockRejectedValue(new Error('agent down'));

    await expect(openWithMcpFallback([], open)).rejects.toThrow('agent down');
    expect(open).toHaveBeenCalledTimes(1);
  });
});
