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

/**
 * Parses the argument of a `/goal` command into the next goal value.
 * - non-empty text → that text (trimmed) becomes the goal
 * - empty/whitespace → `null` (clears the goal)
 */
export function parseGoalArgs(args: string): string | null {
  const trimmed = (args ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
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
