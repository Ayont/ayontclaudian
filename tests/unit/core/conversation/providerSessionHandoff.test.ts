import {
  computeProviderSessionHandoff,
  needsProviderContextBootstrap,
  type ProviderSessionSnapshot,
} from '@/core/conversation/providerSessionHandoff';
import { KimiConversationHistoryService } from '@/providers/kimi/history/KimiConversationHistoryService';

describe('computeProviderSessionHandoff', () => {
  it('stashes the outgoing provider session and starts the incoming provider clean', () => {
    const result = computeProviderSessionHandoff({
      oldProviderId: 'claude',
      newProviderId: 'vibe',
      currentSessionId: 'claude-sess-1',
      currentProviderState: { providerSessionId: 'claude-sess-1' },
      providerSessions: undefined,
    });

    // Incoming provider has no prior session → start fresh (no foreign id).
    expect(result.sessionId).toBeNull();
    expect(result.providerState).toBeUndefined();

    // Outgoing provider's live session is preserved under its own key.
    expect(result.providerSessions.claude).toEqual({
      sessionId: 'claude-sess-1',
      providerState: { providerSessionId: 'claude-sess-1' },
    });
  });

  it('restores the incoming provider\'s own previously-stashed session (switch back)', () => {
    const providerSessions: Record<string, ProviderSessionSnapshot> = {
      claude: { sessionId: 'claude-sess-1', providerState: { providerSessionId: 'claude-sess-1' } },
    };

    // Switching Vibe → Claude: Claude must resume ITS own session, not Vibe's id.
    const result = computeProviderSessionHandoff({
      oldProviderId: 'vibe',
      newProviderId: 'claude',
      currentSessionId: 'vibe-ses-9',
      currentProviderState: { sessionId: 'vibe-ses-9' },
      providerSessions,
    });

    expect(result.sessionId).toBe('claude-sess-1');
    expect(result.providerState).toEqual({ providerSessionId: 'claude-sess-1' });
    // The outgoing Vibe session is now stashed too.
    expect(result.providerSessions.vibe).toEqual({
      sessionId: 'vibe-ses-9',
      providerState: { sessionId: 'vibe-ses-9' },
    });
    // Claude's stash is retained.
    expect(result.providerSessions.claude).toEqual(providerSessions.claude);
  });

  it('never resumes a foreign session id after a chain of switches', () => {
    // Claude → Vibe
    const a = computeProviderSessionHandoff({
      oldProviderId: 'claude',
      newProviderId: 'vibe',
      currentSessionId: 'claude-1',
      currentProviderState: { providerSessionId: 'claude-1' },
    });
    expect(a.sessionId).toBeNull();

    // Vibe runs and writes its session into the shared fields, then Vibe → Grok.
    const b = computeProviderSessionHandoff({
      oldProviderId: 'vibe',
      newProviderId: 'grok',
      currentSessionId: 'vibe-1',
      currentProviderState: { sessionId: 'vibe-1' },
      providerSessions: a.providerSessions,
    });
    expect(b.sessionId).toBeNull();

    // Grok → Claude must give Claude back claude-1, never vibe-1 or a grok id.
    const c = computeProviderSessionHandoff({
      oldProviderId: 'grok',
      newProviderId: 'claude',
      currentSessionId: 'grok-1',
      currentProviderState: { sessionId: 'grok-1' },
      providerSessions: b.providerSessions,
    });
    expect(c.sessionId).toBe('claude-1');
    expect(c.providerSessions.vibe?.sessionId).toBe('vibe-1');
    expect(c.providerSessions.grok?.sessionId).toBe('grok-1');
  });

  it('isolates the FULL providerState per provider across a round-trip', () => {
    // Claude active with rich provider state, then Claude → Kimi.
    const a = computeProviderSessionHandoff({
      oldProviderId: 'claude',
      newProviderId: 'kimi',
      currentSessionId: 'claude-1',
      currentProviderState: { providerSessionId: 'claude-1', subagentData: { x: 1 } },
    });
    expect(a.providerState).toBeUndefined(); // Kimi starts clean

    // Kimi runs and writes its own state, then Kimi → Claude.
    const b = computeProviderSessionHandoff({
      oldProviderId: 'kimi',
      newProviderId: 'claude',
      currentSessionId: 'kimi-1',
      currentProviderState: { sessionId: 'kimi-1', goal: 'finish' },
      providerSessions: a.providerSessions,
    });

    // Claude's FULL provider state (not just the session id) is restored intact.
    expect(b.providerState).toEqual({ providerSessionId: 'claude-1', subagentData: { x: 1 } });
    // And Kimi's own state is now stashed for its next turn.
    expect(b.providerSessions.kimi?.providerState).toEqual({ sessionId: 'kimi-1', goal: 'finish' });
  });

  it('does not mutate the provided providerSessions map (immutability)', () => {
    const providerSessions: Record<string, ProviderSessionSnapshot> = {
      claude: { sessionId: 'claude-1' },
    };
    const snapshot = JSON.stringify(providerSessions);

    computeProviderSessionHandoff({
      oldProviderId: 'vibe',
      newProviderId: 'claude',
      currentSessionId: 'vibe-1',
      providerSessions,
    });

    expect(JSON.stringify(providerSessions)).toBe(snapshot);
  });

  it('treats a missing current session as a clean stash', () => {
    const result = computeProviderSessionHandoff({
      oldProviderId: 'claude',
      newProviderId: 'kimi',
      currentSessionId: null,
    });

    expect(result.sessionId).toBeNull();
    expect(result.providerSessions.claude).toEqual({ sessionId: null, providerState: undefined });
  });
});

describe('needsProviderContextBootstrap', () => {
  it('requires bounded context when the target provider has no resumable state', () => {
    expect(needsProviderContextBootstrap({ sessionId: null, providerState: undefined })).toBe(true);
  });

  it('does not duplicate context when a native session is restored', () => {
    expect(needsProviderContextBootstrap({ sessionId: 'session-1', providerState: undefined })).toBe(false);
  });

  it('does not duplicate context for providers that resume through providerState', () => {
    expect(needsProviderContextBootstrap(
      { sessionId: null, providerState: { threadId: 'thread-1' } },
      'thread-1',
    )).toBe(false);
  });

  it('does not treat Kimi metadata without a session id as resumable context', () => {
    const restored = {
      sessionId: null,
      providerState: { goal: 'finish the task', forkParentId: 'parent-session' },
    };
    const resolvedSessionId = new KimiConversationHistoryService()
      .resolveSessionIdForConversation({
        id: 'kimi-handoff',
        providerId: 'kimi',
        title: 'Kimi handoff',
        createdAt: 1,
        updatedAt: 2,
        sessionId: restored.sessionId,
        providerState: restored.providerState,
        messages: [],
      });

    expect(resolvedSessionId).toBeNull();
    expect(needsProviderContextBootstrap(restored, resolvedSessionId)).toBe(true);
  });
});
