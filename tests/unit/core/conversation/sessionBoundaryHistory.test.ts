import { historyInContext, preserveHistoryBeforeSessionBoundary } from '@/core/conversation/sessionBoundaryHistory';
import type { ChatMessage } from '@/core/types';

function msg(id: string, role: ChatMessage['role'], extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content: id, timestamp: Number(id.replace(/\D/g, '')) || 0, ...extra };
}

describe('preserveHistoryBeforeSessionBoundary', () => {
  it('returns the hydrated transcript untouched when no fresh session was started', () => {
    const cached = [msg('u1', 'user'), msg('a2', 'assistant')];
    const hydrated = [msg('x1', 'user'), msg('x2', 'assistant')];
    expect(preserveHistoryBeforeSessionBoundary(cached, hydrated)).toBe(hydrated);
  });

  it('prepends the local turns the fresh native session never saw', () => {
    const boundary = msg('a2', 'assistant', { sessionBoundary: 'condensed' });
    const cached = [msg('u1', 'user'), boundary, msg('u3', 'user'), msg('a4', 'assistant')];
    // The provider replaced the transcript with its new native session only.
    const hydrated = [msg('n3', 'user'), msg('n4', 'assistant')];

    const merged = preserveHistoryBeforeSessionBoundary(cached, hydrated);

    expect(merged.map((message) => message.id)).toEqual(['u1', 'a2', 'n3', 'n4']);
    expect(merged[1].sessionBoundary).toBe('condensed');
  });

  it('keeps everything up to the newest boundary when sessions were restarted twice', () => {
    const cached = [
      msg('u1', 'user'),
      msg('a2', 'assistant', { sessionBoundary: 'condensed' }),
      msg('u3', 'user'),
      msg('a4', 'assistant', { sessionBoundary: 'condensed' }),
      msg('u5', 'user'),
    ];
    const hydrated = [msg('n5', 'user')];
    expect(preserveHistoryBeforeSessionBoundary(cached, hydrated).map((message) => message.id))
      .toEqual(['u1', 'a2', 'u3', 'a4', 'n5']);
  });

  it('does not duplicate when the provider already merged local messages', () => {
    const cached = [msg('u1', 'user'), msg('a2', 'assistant', { sessionBoundary: 'condensed' }), msg('u3', 'user')];
    const hydrated = [...cached];
    expect(preserveHistoryBeforeSessionBoundary(cached, hydrated)).toBe(hydrated);
  });

  it('keeps the local transcript when the new session has nothing to hydrate yet', () => {
    const cached = [msg('u1', 'user'), msg('a2', 'assistant', { sessionBoundary: 'condensed' })];
    expect(preserveHistoryBeforeSessionBoundary(cached, []).map((message) => message.id)).toEqual(['u1', 'a2']);
  });
});

describe('historyInContext', () => {
  it('keeps the whole history when nothing was compacted', () => {
    expect(historyInContext([msg('u1', 'user'), msg('a2', 'assistant')]).map((m) => m.id)).toEqual(['u1', 'a2']);
  });

  it('starts at the latest compaction, where the summary begins', () => {
    const history = [
      msg('u1', 'user'),
      msg('a2', 'assistant', { contentBlocks: [{ type: 'context_compacted' }] }),
      msg('u3', 'user'),
      msg('a4', 'assistant'),
    ];
    expect(historyInContext(history).map((m) => m.id)).toEqual(['a2', 'u3', 'a4']);
  });

  it('starts after a fresh condensed session', () => {
    const history = [msg('u1', 'user'), msg('a2', 'assistant', { sessionBoundary: 'condensed' }), msg('u3', 'user')];
    expect(historyInContext(history).map((m) => m.id)).toEqual(['u3']);
  });

  it('uses whichever boundary is newest', () => {
    const history = [
      msg('a1', 'assistant', { sessionBoundary: 'condensed' }),
      msg('u2', 'user'),
      msg('a3', 'assistant', { contentBlocks: [{ type: 'context_compacted' }] }),
      msg('u4', 'user'),
    ];
    expect(historyInContext(history).map((m) => m.id)).toEqual(['a3', 'u4']);
  });
});
