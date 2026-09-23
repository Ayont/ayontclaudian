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

/**
 * Exit codes of a headless `/goal` run (kimi-code 2.1, `GOAL_EXIT_CODES` in
 * the binary): the goal's final status drives the process exit code.
 */
const KIMI_GOAL_EXIT_STATUS: Record<number, 'complete' | 'blocked' | 'paused'> = {
  0: 'complete',
  3: 'blocked',
  6: 'paused',
};

/** Headless kimi-code only accepts goal *creation*; subcommands run as plain prompts. */
const KIMI_GOAL_SUBCOMMANDS = new Set(['pause', 'resume', 'clear', 'status', 'show', 'edit', 'budget']);

/**
 * The objective of a headless goal-create prompt (`/goal <objective>`), or
 * null for anything else, including goal subcommands.
 */
export function parseKimiGoalCreate(prompt: string): string | null {
  const match = /^\s*\/goal\s+([\s\S]+)$/.exec(prompt);
  if (!match) return null;
  const argument = match[1].trim();
  const first = argument.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!argument || KIMI_GOAL_SUBCOMMANDS.has(first)) return null;
  if (first === 'replace' || first === '--') {
    const objective = argument.slice(first.length).trim();
    return objective || null;
  }
  return argument;
}

/**
 * Creating a goal fails while one exists, so a second goal in the same Kimi
 * session has to replace the first.
 */
export function buildKimiGoalCreatePrompt(objective: string, replaceExisting: boolean): string {
  return replaceExisting ? `/goal replace ${objective}` : `/goal ${objective}`;
}

export function kimiGoalStatusForExit(code: number | null): 'complete' | 'blocked' | 'paused' | null {
  return code === null ? null : KIMI_GOAL_EXIT_STATUS[code] ?? null;
}
