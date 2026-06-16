/**
 * Regression: switching providers mid-chat must not leak a foreign session id
 * into agy. The shared `conversation.sessionId` can hold another provider's id
 * (e.g. a Kimi `ses_…`); passing it to `agy --conversation <id>` makes agy warn
 * "conversation not found". syncConversationState must only adopt the shared id
 * when a real Antigravity transcript exists for it.
 */
jest.mock('@/providers/antigravity/history/AntigravityBrainStore', () => ({
  getAntigravityTranscriptPath: jest.fn((id: string) => `/brain/${id}/transcript.jsonl`),
  hasAntigravityTranscript: jest.fn(),
  readAntigravityTranscript: jest.fn(() => null),
  snapshotBrainConversationIds: jest.fn(() => new Set()),
  discoverNewestConversationId: jest.fn(() => null),
  splitTranscriptLines: jest.fn(() => []),
}));

import { hasAntigravityTranscript } from '@/providers/antigravity/history/AntigravityBrainStore';
import { AntigravityChatRuntime } from '@/providers/antigravity/runtime/AntigravityChatRuntime';

const mockHasTranscript = hasAntigravityTranscript as jest.Mock;

function makeRuntime(): AntigravityChatRuntime {
  return new AntigravityChatRuntime({} as never);
}

describe('AntigravityChatRuntime.syncConversationState', () => {
  beforeEach(() => mockHasTranscript.mockReset());

  it('ignores a foreign shared session id (no agy transcript) → starts fresh', () => {
    mockHasTranscript.mockReturnValue(false);
    const runtime = makeRuntime();
    runtime.syncConversationState({ sessionId: 'ses_12fbe8c5cffeeKimiId', providerState: undefined } as never);
    expect(runtime.getSessionId()).toBeNull();
  });

  it('prefers its own providerState.conversationId over the shared id', () => {
    mockHasTranscript.mockReturnValue(false);
    const runtime = makeRuntime();
    runtime.syncConversationState({
      sessionId: 'ses_foreign',
      providerState: { conversationId: 'agy-own-id' },
    } as never);
    expect(runtime.getSessionId()).toBe('agy-own-id');
  });

  it('adopts a legacy shared id only when a real agy transcript exists', () => {
    mockHasTranscript.mockReturnValue(true);
    const runtime = makeRuntime();
    runtime.syncConversationState({ sessionId: 'agy-legacy-id', providerState: undefined } as never);
    expect(runtime.getSessionId()).toBe('agy-legacy-id');
  });

  it('clears the id when there is no conversation', () => {
    const runtime = makeRuntime();
    runtime.syncConversationState(null);
    expect(runtime.getSessionId()).toBeNull();
  });
});
