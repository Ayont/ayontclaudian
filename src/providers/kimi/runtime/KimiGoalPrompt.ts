/**
 * Lightweight helper for Kimi's "/goal" handling in print-mode.
 *
 * Kimi CLI accepts `/goal <text>` as a single-turn command, but the goal does
 * not reliably persist across subsequent print-mode turns. To make goals usable
 * inside Claudian, we mirror the active goal locally and prepend it to normal
 * prompts so every turn retains the standing objective.
 */

export interface KimiPromptGoalResult {
  /** Goal that should be stored after this turn (null = clear). */
  nextGoal: string | null;
  /** Prompt to actually send to the Kimi CLI. */
  promptToSend: string;
}

const GOAL_COMMAND_RE = /^[\s]*\/goal(?:[\s]+([\s\S]*))?$/;

/**
 * Resolves the prompt to send and the next persisted goal for a user input.
 *
 * - `/goal <text>`  → sets `nextGoal` to `<text>`, sends the raw `/goal` command.
 * - `/goal`          → clears `nextGoal`, sends the raw `/goal` command.
 * - normal prompt    → if a goal is active, prepends `[Goal: <goal>]\n\n`.
 */
export function prepareKimiPromptWithGoal(
  prompt: string,
  currentGoal: string | null,
): KimiPromptGoalResult {
  const goalMatch = prompt.match(GOAL_COMMAND_RE);
  if (goalMatch) {
    const newGoal = goalMatch[1]?.trim() ?? '';
    return {
      nextGoal: newGoal ? newGoal : null,
      promptToSend: prompt.trimStart(),
    };
  }

  if (currentGoal) {
    return {
      nextGoal: currentGoal,
      promptToSend: `[Goal: ${currentGoal}]\n\n${prompt}`,
    };
  }

  return {
    nextGoal: null,
    promptToSend: prompt,
  };
}
