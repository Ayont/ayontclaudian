/**
 * Provider-owned persisted state for the DeepSeek Harness (dsh) provider.
 *
 * The headless profile answers one task per invocation and has NO resume flag
 * (verified: dsh --profile headless --resume ... -> unknown option), so there
 * is nothing to replay into the CLI. The session reference recorded here is
 * the transcript directory dsh flushed for the most recent turn —
 * informational, used for conversation cleanup and future transcript work.
 */
export interface DshProviderState {
  /** Directory name of the newest flushed dsh session (e.g. session-<uuid>). */
  sessionId?: string;
  /** Absolute path of that session directory under ~/.dsh/sessions/. */
  sessionDir?: string;
}

export function getDshState(providerState?: Record<string, unknown>): DshProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: DshProviderState = {};
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    state.sessionId = record.sessionId.trim();
  }
  if (typeof record.sessionDir === 'string' && record.sessionDir.trim()) {
    state.sessionDir = record.sessionDir.trim();
  }
  return state;
}

export function buildPersistedDshState(
  state: DshProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.sessionId) {
    entries.sessionId = state.sessionId;
  }
  if (state.sessionDir) {
    entries.sessionDir = state.sessionDir;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}
