/**
 * Claudian - Built-in slash commands
 *
 * System commands that perform actions (not prompt expansions).
 * These are handled separately from user-defined slash commands.
 */

import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderCapabilities, ProviderId } from '../providers/types';

export type BuiltInCommandAction = 'clear' | 'add-dir' | 'resume' | 'fork' | 'undo' | 'branches' | 'command-center' | 'export-html' | 'export-pdf' | 'goal' | 'workflow' | 'schedule' | 'team' | 'template' | 'vault-health' | 'artifact' | 'document' | 'email' | 'image' | 'skill' | 'packet-tracer' | 'status';
type BuiltInCommandCapability = 'supportsNativeHistory' | 'supportsFork';
type BuiltInCommandSupportContext = ProviderId | Pick<ProviderCapabilities, BuiltInCommandCapability>;

export interface BuiltInCommand {
  name: string;
  aliases?: string[];
  description: string;
  action: BuiltInCommandAction;
  /** Whether this command accepts arguments. */
  hasArgs?: boolean;
  /** Hint for arguments shown in dropdown (e.g., "path"). */
  argumentHint?: string;
  /** When set, provider capabilities must expose this feature. */
  requiredCapability?: BuiltInCommandCapability;
}

export interface BuiltInCommandResult {
  command: BuiltInCommand;
  /** Arguments passed to the command (trimmed, after command name). */
  args: string;
}

export const BUILT_IN_COMMANDS: BuiltInCommand[] = [
  {
    name: 'clear',
    aliases: ['new'],
    description: 'Start a new conversation',
    action: 'clear',
  },
  {
    name: 'add-dir',
    description: 'Add external context directory',
    action: 'add-dir',
    hasArgs: true,
    argumentHint: '[path/to/directory]',
  },
  {
    name: 'resume',
    description: 'Resume a previous conversation',
    action: 'resume',
    requiredCapability: 'supportsNativeHistory',
  },
  {
    name: 'fork',
    description: 'Fork entire conversation to new session',
    action: 'fork',
    requiredCapability: 'supportsFork',
  },
  {
    name: 'undo',
    description: 'Revert file changes from the last agent turn',
    action: 'undo',
  },
  {
    name: 'branches',
    aliases: ['tree'],
    description: 'Show the visual conversation branch tree',
    action: 'branches',
  },
  {
    name: 'commands',
    aliases: ['center'],
    description: 'Open the searchable command, skill, snippet, and memory center',
    action: 'command-center',
  },
  {
    name: 'export-html',
    description: 'Export the active conversation as styled HTML',
    action: 'export-html',
  },
  {
    name: 'export-pdf',
    description: 'Export the active conversation as an A4 PDF',
    action: 'export-pdf',
  },
  {
    name: 'goal',
    description: 'Set a standing goal (empty clears it)',
    action: 'goal',
    hasArgs: true,
    argumentHint: '[goal text]',
  },
  {
    name: 'workflow',
    aliases: ['wf'],
    description: 'Insert a saved prompt workflow',
    action: 'workflow',
    hasArgs: true,
    argumentHint: '[name] [args]',
  },
  {
    name: 'schedule',
    aliases: ['cron'],
    description: 'Run an agent prompt hourly or daily in the background',
    action: 'schedule',
    hasArgs: true,
    argumentHint: '[hourly|daily|daily@HH:MM] [task]',
  },
  {
    name: 'team',
    description: 'Run a multi-agent team on a task inline in chat',
    action: 'team',
    hasArgs: true,
    argumentHint: '[task]',
  },
  {
    name: 'template',
    aliases: ['tpl'],
    description: 'Insert a reusable prompt template',
    action: 'template',
    hasArgs: true,
    argumentHint: '[name]',
  },
  {
    name: 'vault-health',
    aliases: ['vh'],
    description: 'Run a vault health check',
    action: 'vault-health',
    hasArgs: true,
    argumentHint: '[orphan-check|tag-dedupe|link-suggest|dedupe]',
  },
  {
    name: 'artifact',
    aliases: ['art'],
    description: 'Create an interactive artifact (HTML page) from the conversation',
    action: 'artifact',
    hasArgs: true,
    argumentHint: '[description of what to build]',
  },
  {
    name: 'document',
    aliases: ['doc'],
    description: 'Build a designed live document directly in chat',
    action: 'document',
    hasArgs: true,
    argumentHint: '[document request]',
  },
  {
    name: 'email',
    aliases: ['mail'],
    description: 'Eine kompakte E-Mail-Vorlage im Chat erstellen',
    action: 'email',
    hasArgs: true,
    argumentHint: '[E-Mail-Wunsch]',
  },
  {
    name: 'image',
    aliases: ['img'],
    description: 'Generate an image and render it as an inline vault card',
    action: 'image',
    hasArgs: true,
    argumentHint: '[image description]',
  },
  {
    name: 'skill',
    aliases: ['skills'],
    description: 'Einen perfekten Agent-Skill (SKILL.md) erstellen',
    action: 'skill',
    hasArgs: true,
    argumentHint: '[was der Skill können soll]',
  },
  {
    name: 'packet-tracer',
    aliases: ['pkt'],
    description: 'Create, read, or export Cisco Packet Tracer lab material',
    action: 'packet-tracer',
    hasArgs: true,
    argumentHint: '[create|read|export] [request or vault path]',
  },
  {
    name: 'status',
    aliases: ['claudian'],
    description: 'Show a Claudian status card (provider, model, context, memory, budget)',
    action: 'status',
  },
];

/** Map of command names/aliases to their definitions. */
const commandMap = new Map<string, BuiltInCommand>();

for (const cmd of BUILT_IN_COMMANDS) {
  commandMap.set(cmd.name.toLowerCase(), cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandMap.set(alias.toLowerCase(), cmd);
    }
  }
}

function resolveCapabilities(
  context: BuiltInCommandSupportContext,
): Pick<ProviderCapabilities, BuiltInCommandCapability> | null {
  if (typeof context !== 'string') {
    return context;
  }

  try {
    return ProviderRegistry.getCapabilities(context);
  } catch {
    return null;
  }
}

export function isBuiltInCommandSupported(
  command: BuiltInCommand,
  context?: BuiltInCommandSupportContext,
): boolean {
  if (!command.requiredCapability || !context) {
    return true;
  }

  const capabilities = resolveCapabilities(context);
  return capabilities ? capabilities[command.requiredCapability] : false;
}

/**
 * Checks if input is a built-in command.
 * Returns the command and arguments if found, null otherwise.
 */
export function detectBuiltInCommand(input: string): BuiltInCommandResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // Extract command name (first word after /)
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s(.*))?$/);
  if (!match) return null;

  const cmdName = match[1].toLowerCase();
  const command = commandMap.get(cmdName);
  if (!command) return null;

  const args = (match[2] || '').trim();

  return { command, args };
}

/** Parses `/command … && /command …` or one slash-command per line. */
export function parseBuiltInCommandChain(input: string): BuiltInCommandResult[] | null {
  const segments = input
    .split(/\s*&&\s*|\n(?=\s*\/)/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) return null;
  const commands = segments.map(detectBuiltInCommand);
  return commands.every((command): command is BuiltInCommandResult => command !== null)
    ? commands
    : null;
}

/**
 * Gets built-in commands for dropdown display.
 * When providerId is given, excludes commands restricted to other providers.
 */
export function getBuiltInCommandsForDropdown(context?: BuiltInCommandSupportContext): Array<{
  id: string;
  name: string;
  description: string;
  content: string;
  argumentHint?: string;
}> {
  return BUILT_IN_COMMANDS
    .filter((cmd) => isBuiltInCommandSupported(cmd, context))
    .map((cmd) => ({
      id: `builtin:${cmd.name}`,
      name: cmd.name,
      description: cmd.description,
      content: '', // Built-in commands don't have prompt content
      argumentHint: cmd.argumentHint,
    }));
}
