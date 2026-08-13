export interface ClineProviderState {
  sessionId?: string;
}

/** Cline CLI session ids look like `1786522352621_1rqet`. */
export function isClineNativeSessionId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{10,}_[A-Za-z0-9]+$/.test(value.trim());
}

export function getClineState(providerState?: Record<string, unknown>): ClineProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  if (typeof record.sessionId === 'string' && isClineNativeSessionId(record.sessionId)) {
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
