import type { Conversation } from '@/core/types';
import { HermesConversationHistoryService } from '@/providers/hermes/history/HermesConversationHistoryService';
import * as historyStore from '@/providers/hermes/history/HermesHistoryStore';

const STATE_PATH = '/home/a/.hermes/state.db';

function createConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    messages: [],
    providerId: 'hermes',
    providerState: { sessionId: 'sess-1', statePath: STATE_PATH },
    sessionId: 'sess-1',
    ...overrides,
  } as Conversation;
}

describe('HermesConversationHistoryService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hydrates from the recorded session and caches the result', async () => {
    const service = new HermesConversationHistoryService();
    const load = jest.spyOn(historyStore, 'loadHermesSessionMessages').mockResolvedValue([
      { content: 'Hallo', id: 'hermes-1', role: 'user', timestamp: 1 },
    ] as never);
    const conversation = createConversation();

    await service.hydrateConversationHistory(conversation, null);
    await service.hydrateConversationHistory(conversation, null);

    expect(conversation.messages).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a Hermes session id', async () => {
    const service = new HermesConversationHistoryService();
    const load = jest.spyOn(historyStore, 'loadHermesSessionMessages');
    const conversation = createConversation({ providerState: {}, sessionId: null });

    await service.hydrateConversationHistory(conversation, null);

    expect(load).not.toHaveBeenCalled();
    expect(conversation.messages).toEqual([]);
  });

  it('re-reads after a diagnostic result so a transient read error can recover', async () => {
    const service = new HermesConversationHistoryService();
    const load = jest.spyOn(historyStore, 'loadHermesSessionMessages').mockResolvedValue([
      {
        content: 'Hermes-Sitzung konnte nicht geladen werden.',
        id: 'hermes-hydration-error-sess-1',
        role: 'assistant',
        timestamp: 1,
      },
    ] as never);
    const conversation = createConversation();

    await service.hydrateConversationHistory(conversation, null);
    await service.hydrateConversationHistory(conversation, null);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports Hermes\' own session id, not the shared field', () => {
    const service = new HermesConversationHistoryService();

    expect(service.resolveSessionIdForConversation(createConversation({
      providerState: { sessionId: 'sess-hermes' },
      sessionId: 'ses_kimi_123',
    }))).toBe('sess-hermes');
  });

  it('never deletes Hermes\' shared session store', async () => {
    const service = new HermesConversationHistoryService();
    const conversation = createConversation();

    await service.deleteConversationSession(conversation, null);

    expect(conversation.providerState).toEqual({ sessionId: 'sess-1', statePath: STATE_PATH });
  });

  it('persists only its own provider state fields', () => {
    const service = new HermesConversationHistoryService();

    expect(service.buildPersistedProviderState?.(createConversation({
      providerState: { databasePath: '/foreign.db', sessionId: 'sess-1', statePath: STATE_PATH },
    }))).toEqual({ sessionId: 'sess-1', statePath: STATE_PATH });
  });

  it('does not support forking', () => {
    const service = new HermesConversationHistoryService();

    expect(service.isPendingForkConversation(createConversation())).toBe(false);
    expect(service.buildForkProviderState('sess-1', 'msg-1')).toEqual({});
  });
});
