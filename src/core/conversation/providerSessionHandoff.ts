/**
 * Claudian - Provider Session Handoff
 *
 * Pure helper that isolates each provider's native CLI session when a bound
 * conversation switches model/provider mid-chat.
 *
 * Problem it solves: a conversation has a single shared `sessionId` + `providerState`
 * bag. Every provider's `buildSessionUpdates` overwrites those shared fields with its
 * OWN native session id. So after Claude → Vibe → Claude, the shared `sessionId`
 * holds Vibe's `ses_…`, and a provider that falls back to `conversation.sessionId`
 * (Claude/Codex/Pi) tries to resume a foreign session → "session not found".
 *
 * The fix: at every cross-provider switch we stash the outgoing provider's live
 * session under its own key and restore the incoming provider's previously-stashed
 * session (or start clean). No provider ever sees another provider's session id, and
 * switching back to a provider resumes its real native session.
 */

/** A single provider's isolated native session snapshot. */
export interface ProviderSessionSnapshot {
  sessionId?: string | null;
  providerState?: Record<string, unknown>;
}

export interface ProviderSessionHandoffInput {
  /** Provider the conversation is leaving. */
  oldProviderId: string;
  /** Provider the conversation is switching to. */
  newProviderId: string;
  /** The conversation's current (outgoing provider's) shared session id. */
  currentSessionId: string | null;
  /** The conversation's current (outgoing provider's) shared provider-state bag. */
  currentProviderState?: Record<string, unknown>;
  /** Previously stashed per-provider sessions, if any. */
  providerSessions?: Record<string, ProviderSessionSnapshot>;
}

export interface ProviderSessionHandoffResult {
  /** Shared `sessionId` to persist for the INCOMING provider (null = start fresh). */
  sessionId: string | null;
  /** Shared `providerState` to persist for the INCOMING provider. */
  providerState: Record<string, unknown> | undefined;
  /** Updated per-provider session map (immutable copy). */
  providerSessions: Record<string, ProviderSessionSnapshot>;
}

/**
 * Computes the session handoff for a cross-provider switch.
 *
 * - Stashes `{ sessionId, providerState }` of the outgoing provider under its key.
 * - Restores the incoming provider's previously-stashed session, or `null` when it
 *   has none (so the incoming provider starts a fresh native session instead of
 *   resuming a foreign id).
 *
 * Always returns NEW objects — never mutates the input (immutability rule).
 */
export function computeProviderSessionHandoff(
  input: ProviderSessionHandoffInput,
): ProviderSessionHandoffResult {
  const previous = input.providerSessions ?? {};

  // Snapshot the outgoing provider's live session under its own key.
  const stashed: Record<string, ProviderSessionSnapshot> = {
    ...previous,
    [input.oldProviderId]: {
      sessionId: input.currentSessionId ?? null,
      providerState: input.currentProviderState,
    },
  };

  // Restore the incoming provider's own session, or start clean.
  const restored = stashed[input.newProviderId];

  return {
    sessionId: restored?.sessionId ?? null,
    providerState: restored?.providerState,
    providerSessions: stashed,
  };
}
