import { HermesRuntimeCommandLoader } from '@/providers/hermes/app/HermesRuntimeCommandLoader';
import * as chatRuntime from '@/providers/hermes/runtime/HermesChatRuntime';

function createContext(overrides: Record<string, unknown> = {}): any {
  return {
    allowSessionCreation: false,
    conversation: null,
    externalContextPaths: [],
    plugin: { settings: { providerConfigs: { hermes: { enabled: true } } } },
    runtime: null,
    ...overrides,
  };
}

function stubRuntime(overrides: Record<string, unknown> = {}): any {
  return {
    cleanup: jest.fn(),
    ensureReady: jest.fn().mockResolvedValue(true),
    getSupportedCommands: jest.fn().mockResolvedValue([{ content: '', id: 'acp:help', name: 'help' }]),
    providerId: 'hermes',
    syncConversationState: jest.fn(),
    ...overrides,
  };
}

describe('HermesRuntimeCommandLoader', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is unavailable while the provider is switched off', () => {
    const loader = new HermesRuntimeCommandLoader();

    expect(loader.isAvailable({ providerConfigs: { hermes: { enabled: false } } })).toBe(false);
    expect(loader.isAvailable({ providerConfigs: { hermes: { enabled: true } } })).toBe(true);
  });

  it('never boots Hermes just to look at a cold blank tab', async () => {
    const spawn = jest.spyOn(chatRuntime, 'HermesChatRuntime');

    await expect(new HermesRuntimeCommandLoader().loadCommands(createContext())).resolves.toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('reuses the bound runtime for a live session', async () => {
    const runtime = stubRuntime();
    const conversation = { messages: [], sessionId: 'sess-1' };

    await expect(new HermesRuntimeCommandLoader().loadCommands(createContext({
      conversation,
      runtime,
    }))).resolves.toEqual([{ content: '', id: 'acp:help', name: 'help' }]);
    expect(runtime.syncConversationState).toHaveBeenCalledWith(conversation, []);
    expect(runtime.cleanup).not.toHaveBeenCalled();
  });

  it('uses a throwaway runtime for a history-backed conversation without a session', async () => {
    const bound = stubRuntime();
    const isolated = stubRuntime();
    jest.spyOn(chatRuntime, 'HermesChatRuntime').mockReturnValue(isolated);

    await new HermesRuntimeCommandLoader().loadCommands(createContext({
      conversation: { messages: [{ content: 'Hallo', role: 'user' }], sessionId: null },
      runtime: bound,
    }));

    // Priming the bound runtime here would create its session early and make
    // the first real turn skip history bootstrap.
    expect(bound.ensureReady).not.toHaveBeenCalled();
    expect(isolated.ensureReady).toHaveBeenCalledWith({ allowSessionCreation: true });
    expect(isolated.cleanup).toHaveBeenCalled();
  });

  it('returns nothing when the runtime cannot start', async () => {
    const runtime = stubRuntime({ ensureReady: jest.fn().mockResolvedValue(false) });

    await expect(new HermesRuntimeCommandLoader().loadCommands(createContext({
      conversation: { messages: [], sessionId: 'sess-1' },
      runtime,
    }))).resolves.toEqual([]);
    expect(runtime.getSupportedCommands).not.toHaveBeenCalled();
  });
});
