import '@/providers';

import { createMockEl } from '@test/helpers/mockElement';
import { Notice } from 'obsidian';

import { InputController, type InputControllerDeps } from '@/features/chat/controllers/InputController';
import { ChatState } from '@/features/chat/state/ChatState';
import { encodeClaudeTurn } from '@/providers/claude/prompt/ClaudeTurnEncoder';

jest.mock('@/providers/desktopBridge/DesktopBridgeTransport', () => ({ queryDesktopBridge: jest.fn(), desktopBridgeProviders: [{ id: 'grok-bot', displayName: 'Grok' }, { id: 'perplexity-chat', displayName: 'Perplexity' }] }));
jest.mock('@/providers/desktopBridge/helper', () => ({ prepareHelper: () => '/fixture', desktopAppPath: () => '/Applications/Fixture.app' }));

// The real check probes each CLI binary; these tests are about routing only.
jest.mock('@/core/diagnostics/providerHealthCheck', () => ({
  ...jest.requireActual('@/core/diagnostics/providerHealthCheck'),
  ensureProviderHealthy: jest.fn().mockResolvedValue({ ok: true }),
}));

jest.mock('@/shared/components/ResumeSessionDropdown', () => ({
  ResumeSessionDropdown: jest.fn(),
}));

jest.mock('@/features/chat/ui/MissionBoard', () => ({
  MissionBoard: jest.fn().mockImplementation(() => ({
    update: jest.fn(),
    remove: jest.fn(),
    scrollIntoView: jest.fn(),
    setAgents: jest.fn(),
    setPhase: jest.fn(),
    setProviderLabels: jest.fn(),
  })),
}));

beforeAll(() => {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
});

const mockNotice = Notice as jest.Mock;

function createMockInputEl() {
  return {
    value: '',
    focus: jest.fn(),
  } as unknown as HTMLTextAreaElement;
}

function createMockWelcomeEl() {
  return createMockEl();
}

function createMockFileContextManager() {
  return {
    startSession: jest.fn(),
    getCurrentNotePath: jest.fn().mockReturnValue(null),
    shouldSendCurrentNote: jest.fn().mockReturnValue(false),
    markCurrentNoteSent: jest.fn(),
    transformContextMentions: jest.fn().mockImplementation((text: string) => text),
  };
}

function createMockImageContextManager() {
  return {
    hasImages: jest.fn().mockReturnValue(false),
    getAttachedImages: jest.fn().mockReturnValue([]),
    getStagedAttachments: jest.fn().mockReturnValue([]),
    clearImages: jest.fn(),
    setImages: jest.fn(),
  };
}

async function* createMockStream(chunks: any[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

const mockMcpForEncoder = {
  extractMentions: jest.fn().mockReturnValue(new Set<string>()),
  transformMentions: jest.fn().mockImplementation((text: string) => text),
};

function createMockAgentService() {
  return {
    providerId: 'claude',
    getCapabilities: jest.fn().mockReturnValue({
      providerId: 'claude',
      supportsPersistentRuntime: true,
      supportsNativeHistory: true,
      supportsPlanMode: true,
      supportsRewind: true,
      supportsFork: true,
      supportsProviderCommands: true,
      supportsTurnSteer: false,
      reasoningControl: 'effort',
    }),
    prepareTurn: jest.fn().mockImplementation((request: any) =>
      encodeClaudeTurn(request, mockMcpForEncoder),
    ),
    query: jest.fn(),
    steer: jest.fn().mockResolvedValue(true),
    softSteer: jest.fn().mockResolvedValue(true),
    cancel: jest.fn(),
    resetSession: jest.fn(),
    setResumeCheckpoint: jest.fn(),
    setApprovedPlanContent: jest.fn(),
    setCurrentPlanFilePath: jest.fn(),
    getApprovedPlanContent: jest.fn().mockReturnValue(null),
    clearApprovedPlanContent: jest.fn(),
    ensureReady: jest.fn().mockResolvedValue(true),
    getSessionId: jest.fn().mockReturnValue(null),
    getAuxiliaryModel: jest.fn().mockReturnValue(null),
    consumeTurnMetadata: jest.fn().mockReturnValue({}),
  };
}



function createMockDeps(overrides: Partial<InputControllerDeps> = {}): InputControllerDeps & { mockAgentService: ReturnType<typeof createMockAgentService> } {
  const state = new ChatState();
  const inputEl = createMockInputEl();
  const queueIndicatorEl = createMockEl();
  queueIndicatorEl.style.display = 'none';
  jest.spyOn(queueIndicatorEl, 'setText');
  state.queueIndicatorEl = queueIndicatorEl as any;

  const imageContextManager = createMockImageContextManager();
  const mockAgentService = createMockAgentService();

  return {
    plugin: {
      saveSettings: jest.fn(),
      settings: {
        permissionMode: 'yolo',
        enableAutoTitleGeneration: true,
      },
      mcpManager: {
        extractMentions: jest.fn().mockReturnValue(new Set()),
        transformMentions: jest.fn().mockImplementation((text: string) => text),
      },
      renameConversation: jest.fn(),
      updateConversation: jest.fn(),
      getConversationSync: jest.fn().mockReturnValue(null),
      getConversationById: jest.fn().mockResolvedValue(null),
      createConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    } as any,
    state,
    renderer: {
      addMessage: jest.fn().mockReturnValue({
        querySelector: jest.fn().mockReturnValue(createMockEl()),
      }),
      refreshActionButtons: jest.fn(),
      removeMessage: jest.fn(),
      updateLiveUserMessage: jest.fn(),
      renderStoredMessage: jest.fn(),
    } as any,
    streamController: {
      showThinkingIndicator: jest.fn(),
      hideThinkingIndicator: jest.fn(),
      handleStreamChunk: jest.fn(),
      finalizeCurrentTextBlock: jest.fn(),
      finalizeCurrentThinkingBlock: jest.fn(),
      appendText: jest.fn(),
    } as any,
    selectionController: {
      getContext: jest.fn().mockReturnValue(null),
    } as any,
    canvasSelectionController: {
      getContext: jest.fn().mockReturnValue(null),
    } as any,
    conversationController: {
      save: jest.fn(),
      generateFallbackTitle: jest.fn().mockReturnValue('Test Title'),
      updateHistoryDropdown: jest.fn(),
      clearTerminalSubagentsFromMessages: jest.fn(),
      updateWelcomeVisibility: jest.fn(),
    } as any,
    getInputEl: () => inputEl,
    getInputContainerEl: () => createMockEl() as any,
    getWelcomeEl: () => null,
    getMessagesEl: () => createMockEl() as any,
    getFileContextManager: () => ({
      startSession: jest.fn(),
      getCurrentNotePath: jest.fn().mockReturnValue(null),
      shouldSendCurrentNote: jest.fn().mockReturnValue(false),
      markCurrentNoteSent: jest.fn(),
      transformContextMentions: jest.fn().mockImplementation((text: string) => text),
    }) as any,
    getImageContextManager: () => imageContextManager as any,
    getMcpServerSelector: () => null,
    getExternalContextSelector: () => null,
    getInstructionModeManager: () => null,
    getInstructionRefineService: () => null,
    getTitleGenerationService: () => null,
    getStatusPanel: () => null,
    generateId: () => `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    resetInputHeight: jest.fn(),
    getAgentService: () => mockAgentService as any,
    getSubagentManager: () => ({ resetSpawnedCount: jest.fn(), resetStreamingState: jest.fn() }) as any,
    mockAgentService,
    ...overrides,
  };
}

/**
 * Composite helper for tests that need a complete "sendable" deps setup.
 * Creates welcomeEl + fileContextManager and sets conversationId by default,
 * eliminating the repeated boilerplate in send-path tests.
 */
function createSendableDeps(
  overrides: Partial<InputControllerDeps> = {},
  conversationId: string | null = 'conv-1',
): InputControllerDeps & { mockAgentService: ReturnType<typeof createMockAgentService> } {
  const welcomeEl = createMockWelcomeEl();
  const fileContextManager = createMockFileContextManager();
  const result = createMockDeps({
    getWelcomeEl: () => welcomeEl,
    getFileContextManager: () => fileContextManager as any,
    ...overrides,
  });
  if (conversationId !== null) {
    result.state.currentConversationId = conversationId;
  }
  return result;
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function nativeGoalDeps(providerId: string, overrides: Partial<InputControllerDeps> = {}) {
  const deps = createSendableDeps({
    setActiveGoal: jest.fn(),
    setNativeGoal: jest.fn(),
    updateNativeGoal: jest.fn(),
    getActiveGoal: () => 'Alle Tests grün',
    ensureServiceInitialized: jest.fn().mockResolvedValue(true),
    ...overrides,
  });
  const runtime = deps.mockAgentService as ReturnType<typeof createMockAgentService> & Record<string, unknown>;
  runtime.providerId = providerId;
  runtime.supportsNativeGoal = () => true;
  runtime.pauseNativeGoal = jest.fn().mockResolvedValue({ objective: 'Alle Tests grün', status: 'paused' });
  runtime.clearNativeGoal = jest.fn().mockResolvedValue(undefined);
  deps.mockAgentService.query.mockImplementation(() => createMockStream([{ type: 'done' }]));
  return { deps, runtime };
}

async function sendComposer(deps: InputControllerDeps, text: string): Promise<void> {
  deps.getInputEl().value = text;
  await new InputController(deps).sendMessage();
  await flush();
}

describe('/goal and the provider\'s own goal system', () => {
  beforeEach(() => mockNotice.mockClear());

  it('hands a Codex goal to the thread and sends the objective as the turn', async () => {
    let owned = false;
    const { deps } = nativeGoalDeps('codex', {
      // As in the tab: recording the native goal makes the provider its owner.
      setNativeGoal: jest.fn(() => { owned = true; }),
      isGoalProviderOwned: () => owned,
    });

    await sendComposer(deps, '/goal Alle Tests grün');

    expect(deps.setNativeGoal).toHaveBeenCalledWith('Alle Tests grün', 'codex');
    expect(deps.setActiveGoal).not.toHaveBeenCalled();
    const request = deps.mockAgentService.prepareTurn.mock.calls[0][0];
    // Carried on the turn itself, so it can never attach to another message.
    expect(request.nativeGoal).toEqual({ kind: 'set', objective: 'Alle Tests grün' });
    expect(request.text.startsWith('Alle Tests grün')).toBe(true);
    expect(request.text).not.toContain('<standing_goal>');
  });

  it('sends Claude its own /goal command without Claudian framing', async () => {
    const { deps } = nativeGoalDeps('claude');

    await sendComposer(deps, '/goal Alle Tests grün');

    const request = deps.mockAgentService.prepareTurn.mock.calls[0][0];
    expect(request.text).toBe('/goal Alle Tests grün');
    expect(request.text).not.toContain('<standing_goal>');
  });

  it('keeps Claudian\'s loop for providers without a goal system', async () => {
    const { deps, runtime } = nativeGoalDeps('grok');
    delete runtime.supportsNativeGoal;

    await sendComposer(deps, '/goal Alle Tests grün');

    expect(deps.setActiveGoal).toHaveBeenCalledWith('Alle Tests grün');
    expect(deps.setNativeGoal).not.toHaveBeenCalled();
    const request = deps.mockAgentService.prepareTurn.mock.calls[0][0];
    expect(request.text).toContain('<standing_goal>');
  });

  it('falls back to Claudian\'s loop when the CLI lacks the goal system', async () => {
    const { deps, runtime } = nativeGoalDeps('claude');
    runtime.supportsNativeGoal = () => false;

    await sendComposer(deps, '/goal Alle Tests grün');

    expect(deps.setActiveGoal).toHaveBeenCalledWith('Alle Tests grün');
  });

  it('does not frame a goal the provider owns into later messages', async () => {
    const { deps } = nativeGoalDeps('codex', { isGoalProviderOwned: () => true });

    await sendComposer(deps, 'Wie weit bist du?');

    const request = deps.mockAgentService.prepareTurn.mock.calls[0][0];
    expect(request.text).not.toContain('<standing_goal>');
  });

  it('pauses a Codex goal inside Codex', async () => {
    const { deps, runtime } = nativeGoalDeps('codex');

    await sendComposer(deps, '/goal pause');

    expect(runtime.pauseNativeGoal).toHaveBeenCalled();
    expect(deps.updateNativeGoal).toHaveBeenCalledWith({ objective: 'Alle Tests grün', status: 'paused' });
    expect(deps.mockAgentService.prepareTurn).not.toHaveBeenCalled();
  });

  it('says so when the provider cannot pause its goal', async () => {
    const { deps } = nativeGoalDeps('claude');

    await sendComposer(deps, '/goal pause');

    expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('kann ein Ziel nicht pausieren'));
    expect(deps.mockAgentService.prepareTurn).not.toHaveBeenCalled();
  });

  it('refuses a goal command while an answer is running instead of queueing it', async () => {
    const { deps } = nativeGoalDeps('codex');
    deps.state.isStreaming = true;

    await new InputController(deps).runGoalCommand('Alle Tests grün');
    await flush();

    expect(mockNotice).toHaveBeenCalledWith(expect.stringContaining('nach der laufenden Antwort'));
    expect(deps.setNativeGoal).not.toHaveBeenCalled();
    expect(deps.mockAgentService.prepareTurn).not.toHaveBeenCalled();
  });

  it('marks a running provider goal paused when the answer is stopped', () => {
    const { deps } = nativeGoalDeps('codex', { onGoalInterrupted: jest.fn() });
    deps.state.isStreaming = true;

    new InputController(deps).cancelStreaming();

    expect(deps.onGoalInterrupted).toHaveBeenCalled();
  });

  it('drops Kimi\'s own copy of the goal on clear', async () => {
    const { deps, runtime } = nativeGoalDeps('kimi');

    await sendComposer(deps, '/goal clear');

    expect(runtime.clearNativeGoal).toHaveBeenCalled();
    expect(deps.setActiveGoal).toHaveBeenCalledWith(null);
  });

  it('clears a Codex goal inside Codex and in the chat', async () => {
    const { deps, runtime } = nativeGoalDeps('codex');

    await sendComposer(deps, '/goal clear');

    expect(runtime.clearNativeGoal).toHaveBeenCalled();
    expect(deps.setActiveGoal).toHaveBeenCalledWith(null);
  });

  it('keeps an unsent draft when Claudian\'s loop starts a goal from the banner', async () => {
    const { deps, runtime } = nativeGoalDeps('grok');
    delete runtime.supportsNativeGoal;
    deps.getInputEl().value = 'halb fertiger Entwurf';

    await new InputController(deps).runGoalCommand('Alle Tests grün');
    await flush();

    expect(deps.getInputEl().value).toBe('halb fertiger Entwurf');
    expect(deps.mockAgentService.prepareTurn.mock.calls[0][0].text).toContain('Alle Tests grün');
  });
});
