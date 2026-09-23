import type { StreamChunk } from '@/core/types';

/**
 * Stands in for an ACP runtime's private `activeTurn` so a test can feed
 * session notifications straight into `handleSessionNotification` and read
 * back exactly what the runtime queued for the chat.
 */
export function attachPlanTestTurn(runtime: unknown, sessionId = 'sess-1'): { chunks: () => StreamChunk[] } {
  const pushed: StreamChunk[] = [];
  const target = runtime as { activeTurn: unknown; sessionId: string | null };
  target.sessionId = sessionId;
  target.activeTurn = {
    queue: { close: () => undefined, fail: () => undefined, push: (chunk: StreamChunk) => pushed.push(chunk) },
    sessionId,
  };
  return { chunks: () => [...pushed] };
}

export function planNotification(
  entries: Array<{ content: string; priority?: 'high' | 'medium' | 'low'; status: string }>,
  sessionId = 'sess-1',
): { sessionId: string; update: Record<string, unknown> } {
  return {
    sessionId,
    update: {
      entries: entries.map((entry) => ({ priority: 'medium', ...entry })),
      sessionUpdate: 'plan',
    },
  };
}

export function todoToolUses(chunks: StreamChunk[]): Array<Extract<StreamChunk, { type: 'tool_use' }>> {
  return chunks.filter(
    (chunk): chunk is Extract<StreamChunk, { type: 'tool_use' }> => chunk.type === 'tool_use' && chunk.name === 'TodoWrite',
  );
}
