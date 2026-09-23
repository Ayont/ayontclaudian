import '@/providers';

import type { PreparedChatTurn } from '@/core/runtime/types';
import type { StreamChunk } from '@/core/types/chat';
import { DEFAULT_CODEX_PRIMARY_MODEL } from '@/providers/codex/types/models';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockTransportRequest = jest.fn();
const mockTransportNotify = jest.fn();
const mockTransportOnNotification = jest.fn();
const mockTransportOnServerRequest = jest.fn();
const mockTransportDispose = jest.fn();
const mockTransportStart = jest.fn();
const mockResolveLaunchSpec = jest.fn();

jest.mock('@/providers/codex/runtime/CodexRpcTransport', () => ({
  CodexRpcTransport: jest.fn().mockImplementation(() => ({
    request: mockTransportRequest,
    notify: mockTransportNotify,
    onNotification: mockTransportOnNotification,
    onServerRequest: mockTransportOnServerRequest,
    dispose: mockTransportDispose,
    start: mockTransportStart,
  })),
}));

const mockProcessStart = jest.fn();
const mockProcessShutdown = jest.fn().mockResolvedValue(undefined);
const mockProcessIsAlive = jest.fn().mockReturnValue(true);
const mockProcessOnExit = jest.fn();
const mockProcessStdin = { write: jest.fn((_c: any, _e: any, cb: any) => cb?.()) };
const mockProcessStdout = {};
const mockProcessStderr = {};

jest.mock('@/providers/codex/runtime/CodexAppServerProcess', () => ({
  CodexAppServerProcess: jest.fn().mockImplementation(() => ({
    start: mockProcessStart,
    shutdown: mockProcessShutdown,
    isAlive: mockProcessIsAlive,
    onExit: mockProcessOnExit,
    get stdin() { return mockProcessStdin; },
    get stdout() { return mockProcessStdout; },
    get stderr() { return mockProcessStderr; },
  })),
}));

jest.mock('@/utils/path', () => ({
  getVaultPath: jest.fn().mockReturnValue('/test/vault'),
}));

jest.mock('@/utils/env', () => ({
  ...jest.requireActual('@/utils/env'),
  getEnhancedPath: jest.fn().mockReturnValue('/usr/bin:/usr/local/bin'),
}));

jest.mock('@/providers/codex/runtime/codexAppServerSupport', () => {
  const actual = jest.requireActual('@/providers/codex/runtime/codexAppServerSupport');
  return {
    ...actual,
    resolveCodexAppServerLaunchSpec: (...args: unknown[]) => mockResolveLaunchSpec(...args),
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { CodexChatRuntime } from '@/providers/codex/runtime/CodexChatRuntime';

type CapturedServerRequestHandler = (requestId: string | number, params: unknown) => Promise<unknown>;

// Notification handlers captured by onNotification
let notificationHandlers: Map<string, (params: unknown) => void>;
let serverRequestHandlers: Map<string, CapturedServerRequestHandler>;

function captureHandlers(): void {
  notificationHandlers = new Map();
  serverRequestHandlers = new Map();

  mockTransportOnNotification.mockImplementation((method: string, handler: any) => {
    notificationHandlers.set(method, handler);
  });

  mockTransportOnServerRequest.mockImplementation((method: string, handler: any) => {
    serverRequestHandlers.set(method, handler);
  });
}

// Emit a notification as if the app-server sent it
function emitNotification(method: string, params: unknown): void {
  const handler = notificationHandlers.get(method);
  if (handler) handler(params);
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPlugin(overrides: Record<string, unknown> = {}): any {
  return {
    settings: {
      model: DEFAULT_CODEX_PRIMARY_MODEL,
      effortLevel: 'medium',
      systemPrompt: '',
      mediaFolder: '',
      userName: '',
      ...overrides,
    },
    getActiveEnvironmentVariables: jest.fn().mockReturnValue(
      'OPENAI_API_KEY=test-key\nOPENAI_BASE_URL=https://example.test/v1',
    ),
    getResolvedProviderCliPath: jest.fn().mockReturnValue('/usr/local/bin/codex'),
    app: {
      vault: {
        adapter: { basePath: '/test/vault' },
      },
    },
  };
}

function createTurn(text = 'hello', overrides: Partial<PreparedChatTurn> = {}): PreparedChatTurn {
  return {
    request: { text },
    persistedContent: text,
    prompt: text,
    isCompact: false,
    mcpMentions: new Set(),
    ...overrides,
  };
}



async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// Default thread/start response
function threadStartResponse(threadId = 'thread-001') {
  return {
    thread: {
      id: threadId,
      path: `/tmp/sessions/${threadId}.jsonl`,
      preview: '',
      ephemeral: false,
      status: { type: 'idle' },
      turns: [] as Array<{ id: string; items: unknown[]; status: string; error: null }>,
      cwd: '/test/vault',
      cliVersion: '0.117.0',
      modelProvider: 'openai_http',
      source: 'vscode',
      createdAt: 0,
      updatedAt: 0,
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
    },
    model: DEFAULT_CODEX_PRIMARY_MODEL,
    modelProvider: 'openai_http',
    serviceTier: null,
    cwd: '/test/vault',
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'workspaceWrite' },
    reasoningEffort: 'medium',
  };
}

function turnStartResponse(turnId = 'turn-001') {
  return {
    turn: { id: turnId, items: [], status: 'inProgress', error: null },
  };
}

// Setup default transport.request mock: initialize → thread/start → turn/start
function setupDefaultRequestMock(
  threadId = 'thread-001',
  turnId = 'turn-001',
  options: { isResume?: boolean } = {},
): void {
  mockTransportRequest.mockImplementation(async (method: string) => {
    switch (method) {
      case 'initialize':
        return { userAgent: 'test/0.1', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' };
      case 'thread/start':
        return threadStartResponse(threadId);
      case 'thread/resume':
        return threadStartResponse(threadId);
      case 'turn/start':
        // After turn/start, schedule notifications
        setTimeout(() => {
          emitNotification('item/agentMessage/delta', {
            threadId, turnId, itemId: 'msg1', delta: 'Hello!',
          });
          emitNotification('thread/tokenUsage/updated', {
            threadId, turnId,
            tokenUsage: {
              total: { totalTokens: 1000, inputTokens: 900, cachedInputTokens: 100, outputTokens: 100, reasoningOutputTokens: 50 },
              last: { totalTokens: 1000, inputTokens: 900, cachedInputTokens: 100, outputTokens: 100, reasoningOutputTokens: 50 },
              modelContextWindow: 200000,
            },
          });
          emitNotification('turn/completed', {
            threadId, turn: { id: turnId, items: [], status: 'completed', error: null },
          });
        }, 0);
        return turnStartResponse(turnId);
      case 'turn/interrupt':
        return {};
      default:
        throw new Error(`Unexpected request: ${method}`);
    }
  });
}

// Find a specific RPC method call from transport request mock
function findCall(method: string) {
  return mockTransportRequest.mock.calls.find((c: any[]) => c[0] === method) as any;
}

// Build a request handler that returns the initialize response for all methods,
// with overrides for specific methods. Every handler gets the initialize case for free.
function buildRequestHandler(
  handlers: Record<string, (...args: any[]) => any>,
): (method: string, ...args: any[]) => Promise<any> {
  const initResponse = { userAgent: 'test/0.1', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' };
  return async (method: string, ...args: any[]) => {
    if (method === 'initialize') return initResponse;
    const handler = handlers[method];
    if (handler) return handler(...args);
    return {};
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


function goal(status: string, overrides: Record<string, unknown> = {}) {
  return {
    threadId: 'thread-001',
    objective: 'Alle Tests grün',
    status,
    tokenBudget: 50_000,
    tokensUsed: 1_200,
    timeUsedSeconds: 30,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function emitTurn(turnId: string, text: string): void {
  emitNotification('turn/started', { threadId: 'thread-001', turn: { id: turnId, items: [], status: 'inProgress', error: null } });
  emitNotification('item/agentMessage/delta', { threadId: 'thread-001', turnId, itemId: `${turnId}-msg`, delta: text });
  emitNotification('turn/completed', { threadId: 'thread-001', turn: { id: turnId, items: [], status: 'completed', error: null } });
}

describe('CodexChatRuntime native goals', () => {
  let runtime: CodexChatRuntime;
  const defaultGrace = CodexChatRuntime.GOAL_CONTINUATION_GRACE_MS;


  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessIsAlive.mockReturnValue(true);
    mockResolveLaunchSpec.mockImplementation((plugin: any) => ({
      target: {
        method: 'host-native',
        platformFamily: 'unix',
        platformOs: 'macos',
      },
      command: plugin.getResolvedProviderCliPath('codex') ?? 'codex',
      args: ['app-server', '--listen', 'stdio://'],
      spawnCwd: '/test/vault',
      targetCwd: '/test/vault',
      env: {
        OPENAI_API_KEY: 'test-key',
        OPENAI_BASE_URL: 'https://example.test/v1',
        PATH: '/usr/bin:/usr/local/bin',
      },
      pathMapper: {
        target: {
          method: 'host-native',
          platformFamily: 'unix',
          platformOs: 'macos',
        },
        toTargetPath: jest.fn((value: string) => value),
        toHostPath: jest.fn((value: string) => value),
        mapTargetPathList: jest.fn((values: string[]) => values),
        canRepresentHostPath: jest.fn(() => true),
      },
    }));
    captureHandlers();
    setupDefaultRequestMock();
    runtime = new CodexChatRuntime(createMockPlugin());
  });

  afterEach(() => {
    runtime.cleanup();
    CodexChatRuntime.GOAL_CONTINUATION_GRACE_MS = defaultGrace;
  });

  const SET = { kind: 'set' as const, objective: 'Alle Tests grün' };

  function goalCalls(): Array<Record<string, unknown>> {
    return mockTransportRequest.mock.calls
      .filter((c: any[]) => c[0] === 'thread/goal/set')
      .map((c: any[]) => c[1]);
  }

  /** turn/start answers with one round; `afterActivation` runs once the goal is activated. */
  function goalServer(options: {
    firstRound?: () => void;
    afterActivation?: () => void;
    activationStatus?: string;
    getGoal?: unknown;
  } = {}) {
    mockTransportRequest.mockImplementation(buildRequestHandler({
      'thread/start': () => threadStartResponse('thread-001'),
      'thread/resume': () => threadStartResponse('thread-001'),
      'thread/goal/get': () => ({ goal: options.getGoal ?? null }),
      'thread/goal/set': (params: { status?: string }) => {
        if (params.status === 'active') {
          setTimeout(() => options.afterActivation?.(), 0);
          return { goal: goal(options.activationStatus ?? 'active') };
        }
        return { goal: goal(params.status ?? 'paused') };
      },
      'thread/goal/clear': () => ({ cleared: true }),
      'turn/start': () => {
        setTimeout(() => (options.firstRound ?? (() => {
          emitNotification('item/agentMessage/delta', { threadId: 'thread-001', turnId: 'turn-001', itemId: 'm1', delta: 'Runde eins.' });
          emitNotification('turn/completed', { threadId: 'thread-001', turn: { id: 'turn-001', items: [], status: 'completed', error: null } });
        }))(), 0);
        return turnStartResponse('turn-001');
      },
      'turn/interrupt': () => ({}),
    }));
  }

  it('declares an rpc goal system and confirms it at runtime', () => {
    expect(runtime.getCapabilities().nativeGoal).toEqual({ mode: 'rpc', canPause: true, persistent: true, resume: 'rpc' });
    expect(runtime.supportsNativeGoal()).toBe(true);
  });

  it('sets the goal paused and sends this prompt as the turn that starts the work', async () => {
    goalServer({ afterActivation: () => emitNotification('thread/goal/updated', { threadId: 'thread-001', goal: goal('complete') }) });

    const chunks = await collectChunks(runtime.query(createTurn('Alle Tests grün + Übertrag', { request: { text: 'Alle Tests grün', nativeGoal: SET } as never })));

    expect(goalCalls()[0]).toEqual({ threadId: 'thread-001', objective: 'Alle Tests grün', status: 'paused' });
    expect(findCall('turn/start')?.[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining('Alle Tests grün + Übertrag') }),
    ]));
    // For the user the goal is running from the start, not "paused".
    expect(chunks.find((c) => c.type === 'goal_update')).toEqual({
      type: 'goal_update',
      goal: expect.objectContaining({ status: 'active', objective: 'Alle Tests grün' }),
    });
  });

  it('activates the goal once the first round ended and follows the rounds Codex starts', async () => {
    goalServer({
      afterActivation: () => {
        emitTurn('turn-r2', 'Runde zwei.');
        emitNotification('thread/goal/updated', { threadId: 'thread-001', goal: goal('complete') });
      },
    });

    const chunks = await collectChunks(runtime.query(createTurn('Alle Tests grün', { request: { text: 'Alle Tests grün', nativeGoal: SET } as never })));

    expect(goalCalls()[1]).toEqual({ threadId: 'thread-001', status: 'active' });
    const order = chunks
      .filter((c) => c.type === 'text' || c.type === 'done' || (c.type === 'goal_update' && c.round))
      .map((c) => (c.type === 'text' ? c.content : c.type === 'goal_update' ? `round ${c.round}` : c.type));
    expect(order).toEqual(['Runde eins.', 'round 2', 'Runde zwei.', 'done']);
    expect(chunks.at(-2)).toEqual({ type: 'goal_update', goal: expect.objectContaining({ status: 'complete' }) });
  });

  it('never activates a goal whose first round was stopped', async () => {
    goalServer({
      firstRound: () => emitNotification('item/agentMessage/delta', { threadId: 'thread-001', turnId: 'turn-001', itemId: 'm1', delta: 'Arbeite…' }),
    });

    for await (const chunk of runtime.query(createTurn('Alle Tests grün', { request: { text: 'Alle Tests grün', nativeGoal: SET } as never }))) {
      if (chunk.type === 'text') runtime.cancel();
    }

    expect(goalCalls().map((c) => c.status)).toEqual(['paused']);
    expect(findCall('turn/interrupt')).toBeDefined();
  });

  it('pauses the goal when Codex starts no further round, so nothing runs unseen', async () => {
    CodexChatRuntime.GOAL_CONTINUATION_GRACE_MS = 10;
    goalServer();

    const chunks = await collectChunks(runtime.query(createTurn('Alle Tests grün', { request: { text: 'Alle Tests grün', nativeGoal: SET } as never })));

    expect(goalCalls().at(-1)).toEqual({ threadId: 'thread-001', status: 'paused' });
    expect(chunks).toContainEqual({ type: 'goal_update', goal: expect.objectContaining({ status: 'paused' }) });
    expect(chunks.at(-1)).toEqual({ type: 'done' });
    expect(chunks.filter((c) => c.type === 'done')).toHaveLength(1);
  });

  it('pauses an active goal between rounds when the answer is stopped', async () => {
    goalServer({
      afterActivation: () => {
        emitNotification('turn/started', { threadId: 'thread-001', turn: { id: 'turn-r2', items: [], status: 'inProgress', error: null } });
        emitNotification('item/agentMessage/delta', { threadId: 'thread-001', turnId: 'turn-r2', itemId: 'm2', delta: 'Runde zwei läuft' });
      },
    });

    for await (const chunk of runtime.query(createTurn('Alle Tests grün', { request: { text: 'Alle Tests grün', nativeGoal: SET } as never }))) {
      if (chunk.type === 'text' && chunk.content === 'Runde zwei läuft') runtime.cancel();
    }

    expect(goalCalls().at(-1)).toEqual({ threadId: 'thread-001', status: 'paused' });
  });

  it('shows and follows a goal the thread still has after a restart', async () => {
    runtime.syncConversationState({ sessionId: 'thread-001', providerState: { threadId: 'thread-001' } } as never);
    goalServer({ getGoal: goal('active'), activationStatus: 'active' });
    CodexChatRuntime.GOAL_CONTINUATION_GRACE_MS = 10;

    const chunks = await collectChunks(runtime.query(createTurn('Wie weit bist du?')));

    expect(chunks.find((c) => c.type === 'goal_update')).toEqual({
      type: 'goal_update',
      goal: expect.objectContaining({ status: 'active' }),
    });
    // It was followed: with no next round the goal is paused rather than left running.
    expect(goalCalls().at(-1)).toEqual({ threadId: 'thread-001', status: 'paused' });
  });

  it('says so when resuming a thread that has no goal', async () => {
    goalServer({ getGoal: null });

    const chunks = await collectChunks(runtime.query(createTurn('Setze fort', { request: { text: 'Setze fort', nativeGoal: { kind: 'resume' } } as never })));

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'notice', content: expect.stringContaining('kein Ziel') }));
    expect(goalCalls()).toEqual([]);
  });

  it('pauses and clears the goal of the loaded thread on request', async () => {
    goalServer({ getGoal: null });
    await collectChunks(runtime.query(createTurn('hallo')));

    await expect(runtime.pauseNativeGoal()).resolves.toEqual(expect.objectContaining({ status: 'paused' }));
    await runtime.clearNativeGoal();

    expect(findCall('thread/goal/clear')?.[1]).toEqual({ threadId: 'thread-001' });
  });

  it('clears a goal the app-server could not take yet before the next turn', async () => {
    runtime.syncConversationState({ sessionId: 'thread-001', providerState: { threadId: 'thread-001' } } as never);
    let clearAttempts = 0;
    mockTransportRequest.mockImplementation(buildRequestHandler({
      'thread/resume': () => threadStartResponse('thread-001'),
      'thread/goal/get': () => ({ goal: null }),
      'thread/goal/clear': () => {
        clearAttempts += 1;
        if (clearAttempts === 1) throw new Error('thread not loaded');
        return { cleared: true };
      },
      'turn/start': () => {
        setTimeout(() => emitNotification('turn/completed', { threadId: 'thread-001', turn: { id: 'turn-001', items: [], status: 'completed', error: null } }), 0);
        return turnStartResponse('turn-001');
      },
    }));

    await runtime.clearNativeGoal();
    await collectChunks(runtime.query(createTurn('weiter')));

    expect(clearAttempts).toBe(2);
    const order = mockTransportRequest.mock.calls.map((c: any[]) => c[0]);
    expect(order.lastIndexOf('thread/goal/clear')).toBeLessThan(order.indexOf('turn/start'));
  });

  it('replaces an unfinished earlier goal when setting a new one fails', async () => {
    let setAttempts = 0;
    mockTransportRequest.mockImplementation(buildRequestHandler({
      'thread/start': () => threadStartResponse('thread-001'),
      'thread/goal/set': (params: { status?: string }) => {
        if (params.status === 'paused') {
          setAttempts += 1;
          if (setAttempts === 1) throw new Error('an unfinished goal exists');
        }
        return { goal: goal(params.status ?? 'paused') };
      },
      'thread/goal/clear': () => ({ cleared: true }),
      'turn/start': () => {
        setTimeout(() => emitNotification('turn/completed', { threadId: 'thread-001', turn: { id: 'turn-001', items: [], status: 'failed', error: null } }), 0);
        return turnStartResponse('turn-001');
      },
    }));

    await collectChunks(runtime.query(createTurn('Neues Ziel', { request: { text: 'Neues Ziel', nativeGoal: SET } as never })));

    const order = mockTransportRequest.mock.calls.map((c: any[]) => c[0]).filter((m: string) => m.startsWith('thread/goal'));
    expect(order.slice(0, 3)).toEqual(['thread/goal/set', 'thread/goal/clear', 'thread/goal/set']);
  });
});
