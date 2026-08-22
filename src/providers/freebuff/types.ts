/**
 * Provider-owned persisted state for the Freebuff provider.
 *
 * Threads live inside the Freebuff desktop app; the plugin drives them over
 * the orchestrator's local HTTP API. The thread id survives across turns so a
 * conversation keeps appending to the same thread, and lastSeq deduplicates
 * replayed SSE events after reconnects (the event bus replays history).
 */
export interface FreebuffProviderState {
  /** Orchestrator thread id backing this conversation. */
  threadId?: string;
  /** Highest agent-event seq already consumed for that thread. */
  lastSeq?: number;
}

export function getFreebuffState(providerState?: Record<string, unknown>): FreebuffProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: FreebuffProviderState = {};
  if (typeof record.threadId === 'string' && record.threadId.trim()) {
    state.threadId = record.threadId.trim();
  }
  if (typeof record.lastSeq === 'number' && Number.isFinite(record.lastSeq)) {
    state.lastSeq = record.lastSeq;
  }
  return state;
}

export function buildPersistedFreebuffState(
  state: FreebuffProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.threadId) {
    entries.threadId = state.threadId;
  }
  if (typeof state.lastSeq === 'number') {
    entries.lastSeq = state.lastSeq;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}