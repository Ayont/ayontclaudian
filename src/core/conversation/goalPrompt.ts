/**
 * Claudian - Provider-agnostic goal prompt
 *
 * A conversation "goal" is a standing objective set via `/goal <text>`. Unlike the
 * Kimi-only prompt-prefix hack, this lives on the conversation and is re-injected
 * into every turn for ANY provider, so the agent keeps the objective in view across
 * turns and across mid-chat provider switches. Pure helpers only — no DOM, no I/O.
 */

/** Frames the standing goal so models reliably treat it as a persistent objective. */
const GOAL_OPEN_TAG = '<standing_goal>';
const GOAL_CLOSE_TAG = '</standing_goal>';

/** Matches a framed standing-goal block (and any trailing blank line) for stripping. */
const GOAL_BLOCK_RE = /<standing_goal>[\s\S]*?<\/standing_goal>\n*/g;

/** Single-word arguments that explicitly clear/complete the goal. */
const GOAL_CLEAR_KEYWORDS = new Set([
  'done', 'clear', 'reset', 'complete', 'fertig', 'erledigt', 'löschen',
]);

/**
 * Parses the argument of a `/goal` command into the next goal value.
 * - empty/whitespace, or a clear keyword (`done`, `clear`, `fertig`, …) → `null` (clears)
 * - any other text → that text (trimmed) becomes the goal
 */
export function parseGoalArgs(args: string): string | null {
  const trimmed = (args ?? '').trim();
  if (!trimmed) return null;
  if (GOAL_CLEAR_KEYWORDS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

/**
 * Prepends the active goal to a turn's prompt so the provider keeps it in view.
 * Returns the prompt unchanged when there is no active goal. Never double-wraps:
 * if the framed block is already present, the prompt is returned as-is.
 */
export function applyGoalPrefix(prompt: string, goal: string | null | undefined): string {
  const trimmedGoal = (goal ?? '').trim();
  if (!trimmedGoal) return prompt;
  if (prompt.includes(GOAL_OPEN_TAG)) return prompt;

  const block = `${GOAL_OPEN_TAG}\n${trimmedGoal}\n${GOAL_CLOSE_TAG}`;
  return prompt ? `${block}\n\n${prompt}` : block;
}

/**
 * Removes framed standing-goal blocks from text. Used when rebuilding context from
 * history so the goal — which is re-injected fresh into the current turn — is not
 * duplicated once per prior turn, saving tokens in long goal-driven sessions.
 */
export function stripGoalBlocks(text: string): string {
  if (!text || !text.includes(GOAL_OPEN_TAG)) return text;
  return text.replace(GOAL_BLOCK_RE, '').trimStart();
}
