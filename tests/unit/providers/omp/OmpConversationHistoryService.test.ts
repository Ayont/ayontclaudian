import type { Conversation } from '@/core/types';
import { OmpConversationHistoryService } from '@/providers/omp/history/OmpConversationHistoryService';
import * as store from '@/providers/omp/history/OmpHistoryStore';

/**
 * `OMP_PROFILE` moves omp's whole agent directory to
 * `~/.omp/profiles/<name>/agent`, transcripts included. The runtime already
 * forwards the variable to the child process, so chatting works — but if replay
 * resolves paths against the plain `process.env` it looks in the default
 * profile and every reopened conversation comes back empty.
 */
describe('OmpConversationHistoryService', () => {
  const conversation = (): Conversation => ({
    id: 'conv-1',
    providerId: 'omp',
    title: 'Test',
    createdAt: 1,
    updatedAt: 2,
    sessionId: '01a0-session',
    messages: [],
  } as unknown as Conversation);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves transcripts with the provider environment, not the bare process env', async () => {
    const spy = jest.spyOn(store, 'loadOmpSessionMessages').mockResolvedValue([]);
    const service = new OmpConversationHistoryService();
    const environment = { HOME: '/Users/tester', OMP_PROFILE: 'work' };

    await service.hydrateConversationHistory(conversation(), '/vault', {
      environment,
      hostPlatform: 'darwin',
    });

    expect(spy).toHaveBeenCalledWith('01a0-session', environment);
  });

  it('works without a path context', async () => {
    const spy = jest.spyOn(store, 'loadOmpSessionMessages').mockResolvedValue([]);
    const service = new OmpConversationHistoryService();

    await service.hydrateConversationHistory(conversation(), '/vault');

    expect(spy).toHaveBeenCalledWith('01a0-session', undefined);
  });

  it('re-hydrates when the profile changes, even for the same session id', async () => {
    const spy = jest.spyOn(store, 'loadOmpSessionMessages')
      .mockResolvedValue([{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }]);
    const service = new OmpConversationHistoryService();
    const conv = conversation();

    await service.hydrateConversationHistory(conv, '/vault', {
      environment: { HOME: '/h', OMP_PROFILE: 'work' },
    });
    await service.hydrateConversationHistory(conv, '/vault', {
      environment: { HOME: '/h', OMP_PROFILE: 'personal' },
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
