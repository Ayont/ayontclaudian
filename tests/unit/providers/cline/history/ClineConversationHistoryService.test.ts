import { shouldReplaceClineHydratedMessages } from '@/providers/cline/history/ClineConversationHistoryService';

describe('shouldReplaceClineHydratedMessages', () => {
  it('keeps the longer in-memory transcript after a provider switch', () => {
    expect(shouldReplaceClineHydratedMessages(3, 1)).toBe(false);
  });

  it('fills an empty conversation from the native Cline session', () => {
    expect(shouldReplaceClineHydratedMessages(0, 4)).toBe(true);
  });
});
