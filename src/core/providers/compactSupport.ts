import type { ProviderCompactSupport } from './types';

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '').toLowerCase();
}

/**
 * The compact command the chat may offer right now, or null.
 *
 * An `advertised` command is only trusted while the agent lists it: sending an
 * unknown slash command to an ACP agent reaches the model as ordinary text.
 */
export function resolveCompactCommand(
  support: Readonly<ProviderCompactSupport> | undefined,
  advertisedCommands: ReadonlyArray<{ name: string }> | null,
): string | null {
  if (!support) {
    return null;
  }
  if (support.availability === 'builtin') {
    return support.command;
  }
  const wanted = normalizeCommandName(support.command);
  const advertised = advertisedCommands?.some((command) => normalizeCommandName(command.name) === wanted) ?? false;
  return advertised ? support.command : null;
}
