import { attachPlanTestTurn, planNotification, todoToolUses } from '@test/helpers/acpPlanTurn';

import { ProviderWorkspaceRegistry } from '@/core/providers/ProviderWorkspaceRegistry';
import { parseTodoInput } from '@/core/tools/todo';
import type ClaudianPlugin from '@/main';
import { KimiAcpChatRuntime } from '@/providers/kimi/runtime/KimiAcpChatRuntime';

function makePlugin(): ClaudianPlugin {
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/vault',
        },
      },
    },
    manifest: { version: '0.0.0-test' },
    settings: {
      providerConfigs: {
        kimi: {
          enabled: true,
          useAcp: true,
        },
      },
    },
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/bin/kimi'),
  } as unknown as ClaudianPlugin;
}

describe('KimiAcpChatRuntime', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Kimi Code 2.1.0 answers `initialize` with mcpCapabilities { http, sse }.
  it('hands Claudian MCP servers to session/new and session/load', async () => {
    jest.spyOn(ProviderWorkspaceRegistry, 'getMcpServerManager').mockReturnValue({
      getServers: () => [
        { name: 'events', config: { type: 'sse', url: 'https://mcp.example/sse' }, enabled: true, contextSaving: false },
      ],
    } as never);
    const runtime = new KimiAcpChatRuntime(makePlugin());
    const connection = {
      negotiatedAgentCapabilities: { mcpCapabilities: { http: true, sse: true } },
      newSession: jest.fn().mockResolvedValue({ sessionId: 'session-new' }),
      loadSession: jest.fn().mockResolvedValue({}),
    };
    (runtime as any).connection = connection;

    await (runtime as any).createSession();
    await (runtime as any).loadSession('session-new');

    const expected = [{ type: 'sse', name: 'events', url: 'https://mcp.example/sse', headers: [] }];
    expect(connection.newSession).toHaveBeenCalledWith({ cwd: '/tmp/vault', mcpServers: expected });
    expect(connection.loadSession).toHaveBeenCalledWith({ cwd: '/tmp/vault', mcpServers: expected, sessionId: 'session-new' });
  });

  it('offers the /compact the ACP agent advertises', () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    expect(runtime.getCapabilities().compact).toEqual({ command: '/compact', availability: 'advertised' });
    expect(runtime.getCapabilities().autoCompact).toBe(true);
  });

  it('keeps the command list Kimi sends outside a turn', async () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    (runtime as any).sessionId = 'session-1';

    await (runtime as any).handleSessionNotification({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'compact', description: 'Compact the context' }],
      },
    });

    const commands = await runtime.getSupportedCommands();
    expect(commands.map((command) => command.name)).toContain('compact');
  });

  it('reports the window fill Kimi sends right after the turn settles', async () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    jest.spyOn(runtime as any, 'ensureReady').mockResolvedValue(true);
    jest.spyOn(runtime as any, 'applyPermissionMode').mockResolvedValue(undefined);
    jest.spyOn(runtime as any, 'applyModel').mockResolvedValue(undefined);
    jest.spyOn(runtime as any, 'applyThinking').mockResolvedValue(undefined);
    (runtime as any).sessionId = 'session-1';
    (runtime as any).connection = {
      prompt: jest.fn().mockImplementation(async () => {
        // Kimi resolves the prompt first, then pushes usage_update.
        setTimeout(() => {
          void (runtime as any).handleSessionNotification({
            sessionId: 'session-1',
            update: { sessionUpdate: 'usage_update', used: 64_000, size: 256_000 },
          });
        }, 5);
        return { stopReason: 'end_turn' };
      }),
    };

    const chunks: any[] = [];
    for await (const chunk of runtime.query({
      isCompact: false,
      mcpMentions: new Set(),
      persistedContent: '',
      prompt: 'Hallo',
      request: { text: 'Hallo' },
    } as any)) {
      chunks.push(chunk);
    }

    const usage = chunks.find((chunk) => chunk.type === 'usage');
    expect(usage?.usage).toMatchObject({ contextTokens: 64_000, contextWindow: 256_000, percentage: 25 });
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('exposes the kimi provider id', () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    expect(runtime.providerId).toBe('kimi');
  });

  it('round-trips provider state through buildSessionUpdates', () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    runtime.syncConversationState({
      providerState: {
        sessionId: 'session-123',
        goal: 'Refactor auth',
        forkParentId: 'session-000',
      },
      sessionId: 'session-123',
    });

    const result = runtime.buildSessionUpdates({
      conversation: null,
      sessionInvalidated: false,
    });

    expect(result.updates.sessionId).toBe('session-123');
    expect(result.updates.providerState).toEqual({
      sessionId: 'session-123',
      goal: 'Refactor auth',
      forkParentId: 'session-000',
    });
  });

  it('clears session when invalidated', () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    runtime.syncConversationState({
      providerState: { sessionId: 'session-123' },
      sessionId: 'session-123',
    });

    const result = runtime.buildSessionUpdates({
      conversation: null,
      sessionInvalidated: true,
    });

    expect(result.updates.providerState).toBeUndefined();
    expect(result.updates.sessionId).toBe('session-123');
  });

  it('reports rewind as unsupported', async () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    const result = await runtime.rewind('user-1', 'assistant-1');
    expect(result.canRewind).toBe(false);
    expect(result.error).toContain('not supported');
  });

  it('shows the ACP plan (Kimi TodoList) as a TodoWrite card', async () => {
    const runtime = new KimiAcpChatRuntime(makePlugin());
    const turn = attachPlanTestTurn(runtime);

    await (runtime as any).handleSessionNotification(planNotification([
      { content: 'Recon', status: 'completed' },
      { content: 'Build', status: 'in_progress' },
    ]));

    const uses = todoToolUses(turn.chunks());
    expect(uses).toHaveLength(1);
    expect(parseTodoInput(uses[0].input)).toEqual([
      { activeForm: 'Recon', content: 'Recon', status: 'completed' },
      { activeForm: 'Build', content: 'Build', status: 'in_progress' },
    ]);
  });
});
