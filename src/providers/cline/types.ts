export interface ClineProviderState {
  sessionId?: string;
}

export function getClineState(providerState?: Record<string, unknown>): ClineProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    return { sessionId: record.sessionId.trim() };
  }
  return {};
}

export function buildPersistedClineState(
  state: ClineProviderState,
): Record<string, unknown> | undefined {
  if (!state.sessionId) {
    return undefined;
  }
  return { sessionId: state.sessionId };
}
