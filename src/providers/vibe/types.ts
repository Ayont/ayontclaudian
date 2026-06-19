/**
 * Provider-owned persisted state for the Vibe (`vibe`) provider.
 *
 * Vibe has native session resume (`--session <id>` / `--continue`), so the only
 * durable state Claudian needs is the session id reported by the CLI after the
 * first run. Live turn events come off stdout (`--output-format stream-json`),
 * not a transcript file, so unlike antigravity there is no cached file path.
 */
export interface VibeProviderState {
  /** Native session id used for `--session <id>` resume. */
  sessionId?: string;
}

export function getVibeState(providerState?: Record<string, unknown>): VibeProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: VibeProviderState = {};
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    state.sessionId = record.sessionId.trim();
  }
  return state;
}

export function buildPersistedVibeState(
  state: VibeProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.sessionId) {
    entries.sessionId = state.sessionId;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}
