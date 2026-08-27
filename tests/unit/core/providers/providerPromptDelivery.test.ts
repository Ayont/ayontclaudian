import '@/providers';

import {
  CLAUDIAN_PROMPT_DELIVERY_STATE_KEY,
  withProviderPromptDelivery,
} from '@/core/providers/providerPromptDelivery';
import { ProviderRegistry } from '@/core/providers/ProviderRegistry';
import type { PromptDeliveryPolicy, ProviderCapabilities } from '@/core/providers/types';
import type { ChatRuntime } from '@/core/runtime/ChatRuntime';
import type {
  ChatRuntimeConversationState,
  ChatRuntimeQueryOptions,
  ChatTurnRequest,
  PreparedChatTurn,
} from '@/core/runtime/types';
import type { ChatMessage, Conversation, StreamChunk } from '@/core/types';

describe('provider prompt delivery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('delivers the system prompt once per persisted provider session', async () => {
    const base = createRuntime('session-1');
    const plugin = createPlugin({ systemPrompt: 'Always verify changes.', userName: 'Niccolo' });
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin,
      policy: 'session-preamble',
    });

    runtime.syncConversationState({ sessionId: 'session-1', providerState: { owned: 'value' } });
    await run(runtime, 'Fix the renderer.');
    await run(runtime, 'Run the tests.');

    expect(base.turns).toHaveLength(2);
    expect(base.turns[0].request.text).toContain('<claudian_system_preamble');
    expect(base.turns[0].request.text).toContain('Always verify changes.');
    expect(base.turns[0].request.text).toContain('You are collaborating with **Niccolo**.');
    expect(base.turns[0].request.text).toContain('/vault/workspace');
    expect(base.turns[0].request.text.endsWith('Fix the renderer.')).toBe(true);
    expect(base.turns[0].prompt).toBe(base.turns[0].request.text);
    expect(base.turns[0].persistedContent).toBe(base.turns[0].request.text);
    expect(base.turns[1].request.text).toBe('Run the tests.');

    const updates = runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false });
    expect(updates.updates.providerState).toEqual(expect.objectContaining({
      owned: 'value',
      [CLAUDIAN_PROMPT_DELIVERY_STATE_KEY]: expect.objectContaining({
        promptKey: expect.any(String),
        sessionId: 'session-1',
      }),
    }));
    expect(JSON.stringify(updates.updates.providerState)).not.toContain('Always verify changes.');
  });

  it('restores the prompt marker after a plugin restart without duplicating the preamble', async () => {
    const plugin = createPlugin({ systemPrompt: 'Use concise answers.' });
    const firstBase = createRuntime('session-1');
    const first = withProviderPromptDelivery(firstBase.runtime, {
      plugin,
      policy: 'session-preamble',
    });
    first.syncConversationState({ sessionId: 'session-1', providerState: {} });
    await run(first, 'First turn');
    const persisted = first.buildSessionUpdates({ conversation: null, sessionInvalidated: false });

    const restartedBase = createRuntime('session-1');
    const restarted = withProviderPromptDelivery(restartedBase.runtime, {
      plugin,
      policy: 'session-preamble',
    });
    restarted.syncConversationState({
      sessionId: 'session-1',
      providerState: persisted.updates.providerState,
    });
    await run(restarted, 'After restart');

    expect(restartedBase.turns[0].request.text).toBe('After restart');
  });

  it('redelivers when custom instructions or the provider session change', async () => {
    const plugin = createPlugin({ systemPrompt: 'Version one.' });
    const base = createRuntime('session-1');
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin,
      policy: 'session-preamble',
    });
    runtime.syncConversationState({ sessionId: 'session-1', providerState: {} });

    await run(runtime, 'First');
    plugin.settings.systemPrompt = 'Version two.';
    await run(runtime, 'Second');
    base.setSessionId('session-2');
    await run(runtime, 'Third');

    expect(base.turns[0].request.text).toContain('Version one.');
    expect(base.turns[1].request.text).toContain('Version two.');
    expect(base.turns[2].request.text).toContain('Version two.');
  });

  it('does not persist a delivery marker when the preamble turn fails', async () => {
    const base = createRuntime('session-1');
    const plugin = createPlugin({ systemPrompt: 'Must survive a failed delivery.' });
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin,
      policy: 'session-preamble',
    });
    runtime.syncConversationState({ sessionId: 'session-1', providerState: {} });

    base.setQueryChunks([
      { type: 'error', content: 'Provider rejected the turn.' },
      { type: 'done' },
    ]);
    await run(runtime, 'First attempt');

    expect(runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false }).updates.providerState)
      .not.toHaveProperty(CLAUDIAN_PROMPT_DELIVERY_STATE_KEY);

    base.setQueryChunks([
      { type: 'text', content: 'ok' },
      { type: 'done' },
    ]);
    await run(runtime, 'Second attempt');

    expect(base.turns[0].request.text).toContain('<claudian_system_preamble');
    expect(base.turns[1].request.text).toContain('<claudian_system_preamble');
  });

  it('never changes raw provider slash commands or marks them delivered', async () => {
    const base = createRuntime('session-1');
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin: createPlugin({ systemPrompt: 'Hidden instructions.' }),
      policy: 'session-preamble',
    });
    runtime.syncConversationState({ sessionId: 'session-1', providerState: {} });

    await run(runtime, '/compact now');

    expect(base.turns[0].request.text).toBe('/compact now');
    expect(runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: false }).updates.providerState)
      .not.toHaveProperty(CLAUDIAN_PROMPT_DELIVERY_STATE_KEY);
  });

  it('delivers on every non-raw stateless turn', async () => {
    const base = createRuntime(null);
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin: createPlugin({ systemPrompt: 'Stateless instructions.' }),
      policy: 'stateless-turn',
    });

    await run(runtime, 'First');
    await run(runtime, 'Second');

    expect(base.turns).toHaveLength(2);
    expect(base.turns.every(turn => turn.request.text.includes('Stateless instructions.'))).toBe(true);
  });

  it('clears a persisted marker on reset and invalidation', async () => {
    const base = createRuntime('session-1');
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin: createPlugin({}),
      policy: 'session-preamble',
    });
    runtime.syncConversationState({ sessionId: 'session-1', providerState: {} });
    await run(runtime, 'Before reset');

    runtime.resetSession();
    base.setSessionId('session-2');
    await run(runtime, 'After reset');
    expect(base.turns[1].request.text).toContain('<claudian_system_preamble');

    const invalidated = runtime.buildSessionUpdates({ conversation: null, sessionInvalidated: true });
    expect(invalidated.updates.providerState).not.toHaveProperty(CLAUDIAN_PROMPT_DELIVERY_STATE_KEY);
  });

  it('returns native-system runtimes unchanged', () => {
    const base = createRuntime('session-1');
    const runtime = withProviderPromptDelivery(base.runtime, {
      plugin: createPlugin({}),
      policy: 'native-system',
    });

    expect(runtime).toBe(base.runtime);
  });

  it('keeps stateless prompt delivery on visible work while verification stays isolated', async () => {
    const base = createRuntime(null);
    const registration = ProviderRegistry.getProviderRegistration('dsh');
    jest.spyOn(registration, 'createRuntime')
      .mockReturnValue(base.runtime);
    const verifierQuery = jest.fn().mockResolvedValue(
      '{"done":true,"reason":"ok","nextStep":"","confidence":1}',
    );
    jest.spyOn(registration, 'createAuxQueryRunner').mockReturnValue({
      query: verifierQuery,
      reset: jest.fn(),
    });
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: createPlugin({ goalLoopMaxIterations: 1 }),
      providerId: 'dsh',
    });

    await run(runtime, '<standing_goal>Finish the task</standing_goal>\n\nDo the work.');

    expect(base.turns).toHaveLength(1);
    expect(base.turns[0].request.text).toContain('<claudian_system_preamble');
    expect(verifierQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('strenger Prüfer'),
      }),
      expect.stringContaining('Finish the task'),
    );
    expect(verifierQuery.mock.calls[0][1]).not.toContain('<claudian_system_preamble');
  });

  it('maps accumulated-work replay to stateless DSH only', async () => {
    const goal = '<standing_goal>Finish the task</standing_goal>\n\nDo the work.';
    const cases = [
      { providerId: 'dsh' as const, expectsReplay: true },
      { providerId: 'claude' as const, expectsReplay: false },
      { providerId: 'kimi' as const, expectsReplay: false },
    ];

    for (const testCase of cases) {
      const base = createRuntime(null);
      base.setQueryChunks([
        { type: 'text', content: 'Ergebnis aus Durchlauf eins.\nGOAL_CONTINUE' },
        { type: 'done' },
      ]);
      jest.spyOn(ProviderRegistry.getProviderRegistration(testCase.providerId), 'createRuntime')
        .mockReturnValue(base.runtime);
      const runtime = ProviderRegistry.createChatRuntime({
        plugin: createPlugin({ goalLoopMaxIterations: 2 }),
        providerId: testCase.providerId,
      });

      await run(runtime, goal);

      expect(base.turns).toHaveLength(2);
      expect(base.turns[1].request.text.includes('<goal_loop_work_so_far>'))
        .toBe(testCase.expectsReplay);
    }
  });

  it('preserves standing-goal framing when composed around Cline', async () => {
    const base = createRuntime('cline-session');
    jest.spyOn(ProviderRegistry.getProviderRegistration('cline'), 'createRuntime')
      .mockReturnValue(base.runtime);
    const runtime = ProviderRegistry.createChatRuntime({
      plugin: createPlugin({}),
      providerId: 'cline',
    });

    await run(runtime, '<standing_goal>Finish the task</standing_goal>\n\nDo the work.');

    expect(base.turns).toHaveLength(1);
    expect(base.turns[0].request.text).toContain('<claudian_system_preamble');
    expect(base.turns[0].request.text).toContain('<standing_goal>Finish the task</standing_goal>');
  });
});

function createPlugin(settings: Record<string, unknown>): any {
  return {
    app: { vault: { adapter: { basePath: '/vault/workspace' } } },
    settings: {
      mediaFolder: 'attachments',
      userName: '',
      workspaceMode: 'code',
      ...settings,
    },
  };
}

function createRuntime(initialSessionId: string | null): {
  runtime: ChatRuntime;
  turns: PreparedChatTurn[];
  setQueryChunks: (chunks: StreamChunk[]) => void;
  setSessionId: (sessionId: string | null) => void;
} {
  let sessionId = initialSessionId;
  const turns: PreparedChatTurn[] = [];
  let queryChunks: StreamChunk[] = [
    { type: 'text', content: 'ok' },
    { type: 'done' },
  ];
  const capabilities = createCapabilities('session-preamble');
  const runtime: ChatRuntime = {
    providerId: 'test',
    getCapabilities: () => capabilities,
    prepareTurn: (request: ChatTurnRequest) => ({
      request,
      prompt: request.text,
      persistedContent: request.text,
      isCompact: false,
      mcpMentions: new Set(),
    }),
    onReadyStateChange: () => () => {},
    setResumeCheckpoint: () => {},
    syncConversationState: (conversation: ChatRuntimeConversationState | null) => {
      sessionId = conversation?.sessionId ?? null;
    },
    reloadMcpServers: async () => {},
    ensureReady: async () => true,
    query: async function* (
      turn: PreparedChatTurn,
      _history?: ChatMessage[],
      _options?: ChatRuntimeQueryOptions,
    ): AsyncGenerator<StreamChunk> {
      turns.push(turn);
      for (const chunk of queryChunks) {
        yield chunk;
      }
    },
    cancel: () => {},
    resetSession: () => { sessionId = null; },
    getSessionId: () => sessionId,
    consumeSessionInvalidation: () => false,
    isReady: () => true,
    getSupportedCommands: async () => [],
    cleanup: () => {},
    rewind: async () => ({ canRewind: false }),
    setApprovalCallback: () => {},
    setApprovalDismisser: () => {},
    setAskUserQuestionCallback: () => {},
    setExitPlanModeCallback: () => {},
    setPermissionModeSyncCallback: () => {},
    setSubagentHookProvider: () => {},
    setAutoTurnCallback: () => {},
    consumeTurnMetadata: () => ({}),
    buildSessionUpdates: () => ({
      updates: {
        providerState: { owned: 'value' },
        sessionId,
      },
    }),
    resolveSessionIdForFork: (_conversation: Conversation | null) => sessionId,
  };
  return {
    runtime,
    turns,
    setQueryChunks: (chunks) => { queryChunks = chunks; },
    setSessionId: (next) => { sessionId = next; },
  };
}

function createCapabilities(promptDelivery: PromptDeliveryPolicy): ProviderCapabilities {
  return {
    providerId: 'test',
    promptDelivery,
    supportsPersistentRuntime: true,
    supportsNativeHistory: true,
    supportsPlanMode: false,
    supportsRewind: false,
    supportsFork: false,
    supportsProviderCommands: false,
    supportsImageAttachments: false,
    supportsInstructionMode: false,
    supportsMcpTools: false,
    supportsMultiAgent: false,
    reasoningControl: 'none',
  };
}

async function run(runtime: ChatRuntime, text: string): Promise<void> {
  const turn = runtime.prepareTurn({ text });
  for await (const chunk of runtime.query(turn)) {
    // Drain the public runtime stream.
    void chunk;
  }
}
