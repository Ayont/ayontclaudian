import type { Conversation } from '@/core/types';
import { GrokConversationHistoryService } from '@/providers/grok/history/GrokConversationHistoryService';

describe('GrokConversationHistoryService bot identity', () => {
  it.each(['explore', null])('preserves bot identity %s when saving runtime state', (botName) => {
    const service = new GrokConversationHistoryService();
    const conversation = { providerState: { sessionId: 'session', botName } } as unknown as Conversation;
    expect(service.buildPersistedProviderState(conversation)).toEqual({ sessionId: 'session', botName });
  });
});
