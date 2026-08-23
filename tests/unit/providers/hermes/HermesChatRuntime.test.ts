import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from '@/core/providers/ProviderSettingsCoordinator';
import type { StreamChunk } from '@/core/types';
import {
  getHermesDiscoveryState,
  updateHermesDiscoveryState,
} from '@/providers/hermes/discoveryState';
import { HermesChatRuntime } from '@/providers/hermes/runtime/HermesChatRuntime';
import { getHermesProviderSettings } from '@/providers/hermes/settings';

const OPUS = 'openrouter:anthropic/claude-opus-5';
const SONNET = 'openrouter:anthropic/claude-sonnet-5';

/** The registry is empty in unit tests; project the plugin settings directly. */
function stubProviderProjection(plugin: { settings: Record<string, unknown> }): void {
  jest.spyOn(ProviderRegistry, 'resolveSettingsProviderId').mockReturnValue('hermes');
  jest.spyOn(ProviderSettingsCoordinator, 'getProviderSettingsSnapshot')
    .mockImplementation(() => plugin.settings);
}

afterEach(() => {
  jest.restoreAllMocks();
});

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    app: { vault: { adapter: { basePath: '/tmp/claudian-test-vault' } } },
    getAllViews: jest.fn().mockReturnValue([]),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/hermes'),
    manifest: { version: '0.0.0-test' },
    saveSettings: jest.fn().mockResolvedValue(undefined),
    settings: { providerConfigs: { hermes: { enabled: true } } },
    ...overrides,
  };
}

function createMockConnection(overrides: Record<string, unknown> = {}): any {
  return {
    cancel: jest.fn(),
    loadSession: jest.fn(),
    newSession: jest.fn(),
    prompt: jest.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    setMode: jest.fn().mockResolvedValue({}),
    setModel: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

/** Drives a turn to completion and returns everything it streamed. */
async function collect(
  runtime: HermesChatRuntime,
  turn: any = { request: { text: 'Hallo' } },
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of runtime.query(turn)) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Puts the runtime into the state it has right after a successful session load. */
function primeSession(runtime: HermesChatRuntime, connection: any, sessionId = 'sess-1'): void {
  stubProviderProjection((runtime as any).plugin);
  (runtime as any).connection = connection;
  (runtime as any).ready = true;
  (runtime as any).sessionId = sessionId;
  (runtime as any).loadedSessionId = sessionId;
  (runtime as any).ensureReady = jest.fn().mockResolvedValue(true);
}

describe('syncConversationState', () => {
  it('reads only Hermes\' own session id, never the shared one', () => {
    const runtime = new HermesChatRuntime(createMockPlugin());

    // A Kimi id left in the shared field after a mid-chat provider switch.
    runtime.syncConversationState({ providerState: {}, sessionId: 'ses_kimi_123' });

    expect(runtime.getSessionId()).toBeNull();
  });

  it('adopts the session id Hermes recorded itself', () => {
    const runtime = new HermesChatRuntime(createMockPlugin());

    runtime.syncConversationState({
      providerState: { sessionId: 'sess-1', statePath: '/home/a/.hermes/state.db' },
      sessionId: 'sess-1',
    });

    expect(runtime.getSessionId()).toBe('sess-1');
  });
});

describe('loadSession', () => {
  it('treats an empty success as a missing session', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    // Verified against hermes-agent 0.20.5: an unknown id answers `{}`.
    const connection = createMockConnection({ loadSession: jest.fn().mockResolvedValue({}) });
    (runtime as any).connection = connection;

    await expect((runtime as any).loadSession('sess-gone', '/vault')).resolves.toBe(false);
  });

  it('accepts a load that carries the session\'s model and mode state', async () => {
    const plugin = createMockPlugin();
    const runtime = new HermesChatRuntime(plugin);
    stubProviderProjection(plugin);
    const connection = createMockConnection({
      loadSession: jest.fn().mockResolvedValue({
        models: { availableModels: [{ modelId: OPUS, name: 'OpenRouter · opus' }], currentModelId: OPUS },
        modes: { availableModes: [{ id: 'default', name: 'Default' }], currentModeId: 'default' },
      }),
    });
    (runtime as any).connection = connection;

    await expect((runtime as any).loadSession('sess-1', '/vault')).resolves.toBe(true);
    expect(runtime.getSessionId()).toBe('sess-1');
  });
});

describe('model catalog discovery', () => {
  it('records the catalog and seeds the first visible model', async () => {
    const plugin = createMockPlugin();
    const runtime = new HermesChatRuntime(plugin);
    stubProviderProjection(plugin);
    const connection = createMockConnection({
      newSession: jest.fn().mockResolvedValue({
        models: {
          availableModels: [
            { description: 'Provider: OpenRouter', modelId: OPUS, name: 'OpenRouter · anthropic/claude-opus-5' },
            { modelId: SONNET, name: 'OpenRouter · anthropic/claude-sonnet-5' },
          ],
          currentModelId: SONNET,
        },
        modes: { availableModes: [{ id: 'default', name: 'Default' }], currentModeId: 'default' },
        sessionId: 'sess-new',
      }),
    });
    (runtime as any).connection = connection;

    await (runtime as any).createSession('/vault');

    expect(getHermesDiscoveryState(plugin.settings).discoveredModels).toEqual([
      { description: 'Provider: OpenRouter', label: 'OpenRouter · anthropic/claude-opus-5', rawId: OPUS },
      { label: 'OpenRouter · anthropic/claude-sonnet-5', rawId: SONNET },
    ]);
    // The session's own model is the one that becomes visible first.
    expect(getHermesProviderSettings(plugin.settings).visibleModels).toEqual([SONNET]);
    expect(plugin.settings.savedProviderModel.hermes).toBe(`hermes:${SONNET}`);
  });
});

describe('applying the selection to a turn', () => {
  it('switches the model over session/set_model exactly once', async () => {
    const plugin = createMockPlugin();
    plugin.settings.providerConfigs.hermes.visibleModels = [OPUS];
    plugin.settings.model = `hermes:${OPUS}`;
    const runtime = new HermesChatRuntime(plugin);
    const connection = createMockConnection();
    primeSession(runtime, connection);
    (runtime as any).currentSessionModelId = SONNET;

    await (runtime as any).applySelectedModel('sess-1');
    await (runtime as any).applySelectedModel('sess-1');

    expect(connection.setModel).toHaveBeenCalledTimes(1);
    expect(connection.setModel).toHaveBeenCalledWith({ modelId: OPUS, sessionId: 'sess-1' });
  });

  it('does not switch to a model the running Hermes does not report', async () => {
    const plugin = createMockPlugin();
    plugin.settings.model = `hermes:${OPUS}`;
    const runtime = new HermesChatRuntime(plugin);
    const connection = createMockConnection();
    primeSession(runtime, connection);
    // A catalog exists, but the selected model is not part of it.
    plugin.settings.providerConfigs.hermes.visibleModels = [SONNET];
    updateHermesDiscoveryState(plugin.settings, {
      discoveredModels: [{ label: 'Sonnet', rawId: SONNET }],
    });

    await (runtime as any).applySelectedModel('sess-1');

    expect(connection.setModel).not.toHaveBeenCalled();
  });

  it('applies the configured mode over session/set_mode', async () => {
    const plugin = createMockPlugin();
    plugin.settings.providerConfigs.hermes.selectedMode = 'dont_ask';
    const runtime = new HermesChatRuntime(plugin);
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await (runtime as any).applySelectedMode('sess-1');

    expect(connection.setMode).toHaveBeenCalledWith({ modeId: 'dont_ask', sessionId: 'sess-1' });
  });
});

describe('vault system prompt', () => {
  it('sends the preamble on the first turn and not again on the second', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await collect(runtime);
    primeSession(runtime, connection);
    await collect(runtime);

    const firstText = connection.prompt.mock.calls[0][0].prompt[0].text as string;
    const secondText = connection.prompt.mock.calls[1][0].prompt[0].text as string;
    expect(firstText).toContain('<claudian-vault-instructions>');
    expect(secondText).not.toContain('<claudian-vault-instructions>');
  });

  it('omits the preamble when the setting is off', async () => {
    const plugin = createMockPlugin();
    plugin.settings.providerConfigs.hermes.injectVaultPrompt = false;
    const runtime = new HermesChatRuntime(plugin);
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await collect(runtime);

    expect(connection.prompt.mock.calls[0][0].prompt[0].text)
      .not.toContain('<claudian-vault-instructions>');
  });

  // Hermes only intercepts a slash command when the prompt STARTS with `/`.
  it('never prefixes a slash command, and keeps the preamble for the next turn', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await collect(runtime, { request: { text: '/compress' } });
    primeSession(runtime, connection);
    await collect(runtime, { request: { text: 'Danke' } });

    expect(connection.prompt.mock.calls[0][0].prompt[0].text).toBe('/compress');
    expect(connection.prompt.mock.calls[1][0].prompt[0].text)
      .toContain('<claudian-vault-instructions>');
  });

  it('re-sends the preamble after the vault prompt itself changed', async () => {
    const plugin = createMockPlugin();
    const runtime = new HermesChatRuntime(plugin);
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await collect(runtime);
    plugin.settings.systemPrompt = 'Antworte immer auf Deutsch.';
    primeSession(runtime, connection);
    await collect(runtime);

    expect(connection.prompt.mock.calls[1][0].prompt[0].text)
      .toContain('<claudian-vault-instructions>');
  });

  it('retries the preamble on the next turn when the prompt failed', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockRejectedValue(new Error('boom')),
    });
    primeSession(runtime, connection);

    await collect(runtime);
    connection.prompt = jest.fn().mockResolvedValue({ stopReason: 'end_turn' });
    primeSession(runtime, connection);
    await collect(runtime);

    expect(connection.prompt.mock.calls[0][0].prompt[0].text)
      .toContain('<claudian-vault-instructions>');
  });
});

describe('steering', () => {
  it('injects guidance into the running turn via Hermes\' /steer command', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);
    (runtime as any).activeTurn = { queue: { close: jest.fn(), push: jest.fn() }, sessionId: 'sess-1' };

    await expect(runtime.steer({ request: { text: '  Lieber Deutsch  ' } } as any)).resolves.toBe(true);
    expect(connection.prompt).toHaveBeenCalledWith({
      prompt: [{ type: 'text', text: '/steer Lieber Deutsch' }],
      sessionId: 'sess-1',
    });
  });

  it('declines to steer with no turn in flight so the message stays queued', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await expect(runtime.steer({ request: { text: 'Hallo' } } as any)).resolves.toBe(false);
    expect(connection.prompt).not.toHaveBeenCalled();
  });

  it('declines to steer when the injection fails', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockRejectedValue(new Error('closed')),
    });
    primeSession(runtime, connection);
    (runtime as any).activeTurn = { queue: { close: jest.fn(), push: jest.fn() }, sessionId: 'sess-1' };

    await expect(runtime.steer({ request: { text: 'Hallo' } } as any)).resolves.toBe(false);
  });

  it('cancels the stream on a soft steer', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);

    await expect(runtime.softSteer({ request: { text: 'Hallo' } } as any)).resolves.toBe(true);
    expect(connection.cancel).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  });
});

describe('turn outcomes', () => {
  it('reports a refusal with no output as an error and invalidates the session', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockResolvedValue({ stopReason: 'refusal' }),
    });
    primeSession(runtime, connection);

    const chunks = await collect(runtime);

    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(true);
    expect(runtime.consumeSessionInvalidation()).toBe(true);
    // The dead session is dropped so the next turn starts a fresh one.
    expect(runtime.getSessionId()).toBeNull();
  });

  it('stays silent about a refusal that arrived after real output', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockImplementation(async () => {
        await (runtime as any).handleSessionNotification({
          sessionId: 'sess-1',
          update: { content: { text: 'Teilantwort', type: 'text' }, sessionUpdate: 'agent_message_chunk' },
        });
        return { stopReason: 'refusal' };
      }),
    });
    primeSession(runtime, connection);

    const chunks = await collect(runtime);

    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false);
    expect(runtime.consumeSessionInvalidation()).toBe(false);
  });

  it('surfaces a transport failure with the captured stderr', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockRejectedValue(new Error('JSON-RPC transport closed')),
    });
    primeSession(runtime, connection);
    (runtime as any).process = { getStderrSnapshot: () => 'ModuleNotFoundError: acp' };

    const chunks = await collect(runtime);
    const error = chunks.find((chunk) => chunk.type === 'error');

    expect(error).toMatchObject({ type: 'error' });
    expect((error as { content: string }).content).toContain('JSON-RPC transport closed');
    expect((error as { content: string }).content).toContain('ModuleNotFoundError: acp');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it('emits usage from the prompt response and the usage_update window', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection({
      prompt: jest.fn().mockImplementation(async () => {
        await (runtime as any).handleSessionNotification({
          sessionId: 'sess-1',
          update: { sessionUpdate: 'usage_update', size: 1_048_576, used: 16_761 },
        });
        return {
          stopReason: 'end_turn',
          usage: { cachedReadTokens: 6784, inputTokens: 16122, outputTokens: 5, totalTokens: 16127 },
        };
      }),
    });
    primeSession(runtime, connection);

    const usageChunks = (await collect(runtime)).filter((chunk) => chunk.type === 'usage');

    expect(usageChunks.length).toBeGreaterThan(0);
    expect(usageChunks[usageChunks.length - 1]).toMatchObject({
      usage: {
        cacheReadInputTokens: 6784,
        contextTokens: 16_761,
        contextWindow: 1_048_576,
        contextWindowIsAuthoritative: true,
        inputTokens: 16122,
      },
    });
  });
});

describe('runtime plumbing', () => {
  it('captures ACP commands even while no turn is active', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    runtime.syncConversationState({ providerState: { sessionId: 'sess-1' }, sessionId: 'sess-1' });
    (runtime as any).loadedSessionId = 'sess-1';

    const commandsPromise = runtime.getSupportedCommands();
    await (runtime as any).handleSessionNotification({
      sessionId: 'sess-1',
      update: {
        availableCommands: [{ description: 'Compress conversation context', name: 'compress' }],
        sessionUpdate: 'available_commands_update',
      },
    });

    await expect(commandsPromise).resolves.toEqual([
      { content: '', description: 'Compress conversation context', id: 'acp:compress', name: 'compress', source: 'sdk' },
    ]);
  });

  it('never creates a session just to answer a command request', async () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    (runtime as any).ready = true;
    (runtime as any).createSession = jest.fn();

    await expect(runtime.getSupportedCommands()).resolves.toEqual([]);
    expect((runtime as any).createSession).not.toHaveBeenCalled();
  });

  it('persists its own session id and state path alongside the shared field', () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    (runtime as any).sessionId = 'sess-1';
    (runtime as any).currentStatePath = '/home/a/.hermes/state.db';

    expect(runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false })).toEqual({
      updates: {
        providerState: { sessionId: 'sess-1', statePath: '/home/a/.hermes/state.db' },
        sessionId: 'sess-1',
      },
    });
  });

  it('drops the persisted state once an invalidated session is gone', () => {
    const runtime = new HermesChatRuntime(createMockPlugin());

    expect(runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: true })).toEqual({
      updates: { providerState: undefined, sessionId: null },
    });
  });

  it('cancels the live session on the ACP connection', () => {
    const runtime = new HermesChatRuntime(createMockPlugin());
    const connection = createMockConnection();
    primeSession(runtime, connection);

    runtime.cancel();

    expect(connection.cancel).toHaveBeenCalledWith({ sessionId: 'sess-1' });
  });

  it('refuses to start when the provider is disabled', async () => {
    const plugin = createMockPlugin();
    plugin.settings.providerConfigs.hermes.enabled = false;
    const runtime = new HermesChatRuntime(plugin);

    await expect(runtime.ensureReady()).resolves.toBe(false);
    expect(runtime.isReady()).toBe(false);
  });

  it('refuses to start when the CLI cannot be resolved', async () => {
    const plugin = createMockPlugin({
      getResolvedProviderCliPath: jest.fn().mockReturnValue(null),
    });
    plugin.settings = { providerConfigs: { hermes: { enabled: true } } };
    const runtime = new HermesChatRuntime(plugin);

    await expect(runtime.ensureReady()).resolves.toBe(false);
  });
});

describe('keepalive', () => {
  it('heartbeats while the turn is silent so the watchdog does not kill it', async () => {
    jest.useFakeTimers();
    try {
      const runtime = new HermesChatRuntime(createMockPlugin());
      let releasePrompt: (() => void) | undefined;
      const connection = createMockConnection({
        prompt: jest.fn().mockImplementation(() => new Promise((resolve) => {
          releasePrompt = () => resolve({ stopReason: 'end_turn' });
        })),
      });
      primeSession(runtime, connection);

      const chunks: StreamChunk[] = [];
      const consumed = (async () => {
        for await (const chunk of runtime.query({ request: { text: 'Hallo' } } as any)) {
          chunks.push(chunk);
        }
      })();

      await jest.advanceTimersByTimeAsync(21_000);
      releasePrompt?.();
      await consumed;

      expect(chunks.some((chunk) => chunk.type === 'keepalive')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
