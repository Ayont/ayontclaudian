/**
 * Claudian - Built-in slash commands
 *
 * System commands that perform actions (not prompt expansions).
 * These are handled separately from user-defined slash commands.
 */

import { ProviderRegistry } from '../providers/ProviderRegistry';
import type { ProviderCapabilities, ProviderId } from '../providers/types';

export type BuiltInCommandAction = 'clear' | 'add-dir' | 'resume' | 'fork' | 'undo' | 'branches' | 'command-center' | 'export-html' | 'export-pdf' | 'goal' | 'workflow' | 'schedule' | 'team' | 'template' | 'vault-health' | 'artifact' | 'document' | 'email' | 'image' | 'skill' | 'packet-tracer' | 'status' | 'fast' | 'daily' | 'summary' | 'todo' | 'canvas';
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
    name: 'daily',
    aliases: ['today'],
    description: 'Aktuelle Daily Note als Kontext anhängen',
    action: 'daily',
  },
  {
    name: 'summary',
    aliases: ['zusammenfassung'],
    description: 'Aktive Notiz strukturiert zusammenfassen',
    action: 'summary',
  },
  {
    name: 'todo',
    aliases: ['tasks'],
    description: 'Offene Aufgaben (- [ ]) im Vault extrahieren',
    action: 'todo',
  },
  {
    name: 'canvas',
    description: 'Aktives Obsidian Canvas analysieren oder Karten generieren',
    action: 'canvas',
  },
  {
    name: 'clear',
    aliases: ['new'],
    description: 'Neue Konversation starten',
    action: 'clear',
  },
  {
    name: 'add-dir',
    description: 'Externes Kontext-Verzeichnis hinzufügen',
    action: 'add-dir',
    hasArgs: true,
    argumentHint: '[path/to/directory]',
  },
  {
    name: 'resume',
    description: 'Vorherige Konversation fortsetzen',
    action: 'resume',
    requiredCapability: 'supportsNativeHistory',
  },
  {
    name: 'fork',
    description: 'Gesamte Konversation in neue Sitzung verzweigen',
    action: 'fork',
    requiredCapability: 'supportsFork',
  },
  {
    name: 'undo',
    description: 'Dateiänderungen der letzten Agent-Runde rückgängig machen',
    action: 'undo',
  },
  {
    name: 'branches',
    aliases: ['tree'],
    description: 'Visuellen Konversations-Baum anzeigen',
    action: 'branches',
  },
  {
    name: 'commands',
    aliases: ['center'],
    description: 'Durchsuchbares Befehls-, Skill-, Snippet- und Erinnerungs-Center öffnen',
    action: 'command-center',
  },
  {
    name: 'export-html',
    description: 'Aktive Konversation als gestyltes HTML exportieren',
    action: 'export-html',
  },
  {
    name: 'export-pdf',
    description: 'Aktive Konversation als A4-PDF exportieren',
    action: 'export-pdf',
  },
  {
    name: 'goal',
    description: 'Stehendes Ziel setzen (leer löscht es)',
    action: 'goal',
    hasArgs: true,
    argumentHint: '[goal text]',
  },
  {
    name: 'workflow',
    aliases: ['wf'],
    description: 'Gespeicherten Prompt-Workflow einfügen',
    action: 'workflow',
    hasArgs: true,
    argumentHint: '[name] [args]',
  },
  {
    name: 'schedule',
    aliases: ['cron'],
    description: 'Agent-Prompt stündlich oder täglich im Hintergrund ausführen',
    action: 'schedule',
    hasArgs: true,
    argumentHint: '[hourly|daily|daily@HH:MM] [task]',
  },
  {
    name: 'team',
    description: 'Multi-Agent-Team für eine Aufgabe inline im Chat ausführen',
    action: 'team',
    hasArgs: true,
    argumentHint: '[task]',
  },
  {
    name: 'template',
    aliases: ['tpl'],
    description: 'Wiederverwendbare Prompt-Vorlage einfügen',
    action: 'template',
    hasArgs: true,
    argumentHint: '[name]',
  },
  {
    name: 'vault-health',
    aliases: ['vh'],
    description: 'Vault-Gesundheitscheck ausführen',
    action: 'vault-health',
    hasArgs: true,
    argumentHint: '[orphan-check|tag-dedupe|link-suggest|dedupe]',
  },
  {
    name: 'artifact',
    aliases: ['art'],
    description: 'Interaktives Artifact (HTML-Seite) aus der Konversation erstellen',
    action: 'artifact',
    hasArgs: true,
    argumentHint: '[Beschreibung, was gebaut werden soll]',
  },
  {
    name: 'document',
    aliases: ['doc'],
    description: 'Designtes Live-Dokument direkt im Chat erstellen',
    action: 'document',
    hasArgs: true,
    argumentHint: '[Dokument-Anfrage]',
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
    description: 'Cisco Packet Tracer Lab-Material erstellen, lesen oder exportieren',
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
  {
    name: 'fast',
    aliases: ['speed'],
    description: 'Speed-Modus umschalten (Claude Fast / Codex Fast)',
    action: 'fast',
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
