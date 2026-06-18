/**
 * Provider-owned persisted state for the Kimi (`kimi-cli`) provider.
 *
 * Kimi has native session resume (`--session <id>` / `--continue`), so the only
 * durable state Claudian needs is the session id reported by the CLI after the
 * first run. Live turn events come off stdout (`--output-format stream-json`),
 * not a transcript file, so unlike antigravity there is no cached file path.
 */
export interface KimiProviderState {
  /** Native session id used for `--session <id>` resume. */
  sessionId?: string;
  /** Active standing goal set via `/goal <text>`; mirrored locally because print-mode goals do not persist reliably. */
  goal?: string;
  /** Parent session id when this conversation was forked via `/fork`. */
  forkParentId?: string;
}

export function getKimiState(providerState?: Record<string, unknown>): KimiProviderState {
  if (!providerState || typeof providerState !== 'object' || Array.isArray(providerState)) {
    return {};
  }
  const record = providerState as Record<string, unknown>;
  const state: KimiProviderState = {};
  if (typeof record.sessionId === 'string' && record.sessionId.trim()) {
    state.sessionId = record.sessionId.trim();
  }
  if (typeof record.goal === 'string' && record.goal.trim()) {
    state.goal = record.goal.trim();
  }
  if (typeof record.forkParentId === 'string' && record.forkParentId.trim()) {
    state.forkParentId = record.forkParentId.trim();
  }
  return state;
}

export function buildPersistedKimiState(
  state: KimiProviderState,
): Record<string, unknown> | undefined {
  const entries: Record<string, unknown> = {};
  if (state.sessionId) {
    entries.sessionId = state.sessionId;
  }
  if (state.goal) {
    entries.goal = state.goal;
  }
  if (state.forkParentId) {
    entries.forkParentId = state.forkParentId;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}
