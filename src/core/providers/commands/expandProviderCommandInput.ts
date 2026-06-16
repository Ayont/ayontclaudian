import type { ProviderCommandEntry } from './ProviderCommandEntry';

/**
 * Client-side slash-command / skill expansion for print-mode CLIs (Kimi,
 * Antigravity) that — unlike the Claude SDK — cannot expand `/command` or
 * `$skill` tokens themselves.
 *
 * When a user message is exactly a known command/skill invocation
 * (`/<name> [args]` or `$<name> [args]`), the matching entry's `content`
 * template is substituted and returned. Anything else passes through unchanged,
 * so ordinary prompts (and unknown tokens) are never altered.
 */

// Whole-input match: a leading / or $ trigger, a command name, optional args
// (which may span multiple lines). Anchored so only a pure invocation expands.
const INVOCATION_RE = /^([/$])([A-Za-z0-9][\w-]*)(?:[ \t]+([\s\S]*))?$/;

/**
 * Substitutes argument placeholders in a command template:
 * - `$ARGUMENTS` → the full argument string
 * - `$1`, `$2`, … → whitespace-split positional arguments (empty when absent)
 *
 * Pure and exported for unit testing.
 */
export function substituteArguments(content: string, args: string): string {
  const trimmedArgs = args.trim();
  const positional = trimmedArgs.length > 0 ? trimmedArgs.split(/\s+/) : [];
  return content
    .replace(/\$ARGUMENTS\b/g, trimmedArgs)
    .replace(/\$(\d+)/g, (_match, index: string) => positional[Number(index) - 1] ?? '');
}

/**
 * Expands a user input line against a catalog of command/skill entries.
 *
 * - A `command` entry: returns its `content` with arguments substituted.
 * - A `skill` entry: returns the skill `content` as context, followed by the
 *   user's trailing request (the text after `$skill`), if any.
 * - No match, empty content, or a non-invocation line: returns the input
 *   unchanged (safe pass-through).
 */
export function expandProviderCommandInput(
  input: string,
  entries: ReadonlyArray<ProviderCommandEntry>,
): string {
  const match = input.trimStart().match(INVOCATION_RE);
  if (!match) {
    return input;
  }

  const [, prefix, name, rawArgs = ''] = match;
  const lowerName = name.toLowerCase();
  const entry = entries.find(
    (candidate) =>
      candidate.insertPrefix === prefix && candidate.name.toLowerCase() === lowerName,
  );

  if (!entry || entry.content.trim().length === 0) {
    return input;
  }

  const expanded = substituteArguments(entry.content, rawArgs);

  if (entry.kind === 'skill') {
    const userRequest = rawArgs.trim();
    return userRequest.length > 0 ? `${expanded}\n\n${userRequest}` : expanded;
  }

  return expanded;
}
