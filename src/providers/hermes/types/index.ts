export interface HermesProviderState {
  /**
   * Hermes' own session id. Kept separate from `Conversation.sessionId`
   * because that shared field can still hold another provider's id after a
   * mid-chat provider switch, and `hermes acp` answers an unknown id with an
   * empty success rather than an error.
   */
  sessionId?: string;
  /** Absolute path of the Hermes state DB the session was recorded in. */
  statePath?: string;
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getHermesState(
  providerState?: Record<string, unknown>,
): HermesProviderState {
  if (!providerState) {
    return {};
  }

  const sessionId = readTrimmedString(providerState.sessionId);
  const statePath = readTrimmedString(providerState.statePath);
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(statePath ? { statePath } : {}),
  };
}

export function buildPersistedHermesState(
  state: HermesProviderState,
): Record<string, unknown> | undefined {
  const persisted: Record<string, unknown> = {
    ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    ...(state.statePath ? { statePath: state.statePath } : {}),
  };

  return Object.keys(persisted).length > 0 ? persisted : undefined;
}
