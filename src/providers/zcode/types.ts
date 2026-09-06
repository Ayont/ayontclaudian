/**
 * Provider-owned persisted state for the ZCode (Z.ai Coding Plan) provider.
 */
export interface ZcodeProviderState {
  /** Session ID used for conversation tracking. */
  sessionId?: string;
  /** Custom model if set. */
  model?: string;
  /** Active reasoning effort. */
  reasoningEffort?: 'low' | 'high' | 'max' | 'off';
}

export function getZcodeState(providerState?: Record<string, unknown>): ZcodeProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: ZcodeProviderState = {};
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    state.sessionId = record.sessionId.trim();
  }
  if (typeof record.model === 'string' && record.model.trim()) {
    state.model = record.model.trim();
  }
  if (
    record.reasoningEffort === 'low' ||
    record.reasoningEffort === 'high' ||
    record.reasoningEffort === 'max' ||
    record.reasoningEffort === 'off'
  ) {
    state.reasoningEffort = record.reasoningEffort;
  }
  return state;
}

export function buildPersistedZcodeState(
  state: ZcodeProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.sessionId) {
    entries.sessionId = state.sessionId;
  }
  if (state.model) {
    entries.model = state.model;
  }
  if (state.reasoningEffort) {
    entries.reasoningEffort = state.reasoningEffort;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}
