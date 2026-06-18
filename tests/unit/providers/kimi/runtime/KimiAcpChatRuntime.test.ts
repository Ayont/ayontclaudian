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
});
