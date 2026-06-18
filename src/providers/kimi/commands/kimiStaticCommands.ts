import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';

function cmd(
  id: string,
  name: string,
  description: string,
  content: string,
  argumentHint?: string,
): ProviderCommandEntry {
  return {
    id: `kimi:${id}`,
    providerId: 'kimi',
    kind: 'command',
    name,
    description,
    content,
    argumentHint,
    scope: 'builtin',
    source: 'builtin',
    isEditable: false,
    isDeletable: false,
    displayPrefix: '/',
    insertPrefix: '/',
  };
}

export const KIMI_STATIC_COMMANDS: ProviderCommandEntry[] = [
  cmd('goal', 'goal', 'Set a standing goal for this session', '/goal $ARGUMENTS', '[goal text]'),
  cmd('skill', 'skill', 'Invoke a Kimi skill (e.g. frontend-design)', '/skill:$ARGUMENTS', '[skill-name] [args]'),
  cmd('new', 'new', 'Start a new Kimi session', '/new'),
  cmd('fork', 'fork', 'Fork the current session', '/fork'),
  cmd('sessions', 'sessions', 'Browse and resume Kimi sessions', '/sessions'),
  cmd('login', 'login', 'Log in to Kimi via the CLI', '/login'),
  cmd('logout', 'logout', 'Log out of Kimi via the CLI', '/logout'),
  cmd('model', 'model', 'Switch the current model', '/model'),
  cmd('plan', 'plan', 'Enter plan mode', '/plan'),
  cmd('swarm', 'swarm', 'Start a Kimi agent swarm', '/swarm $ARGUMENTS', '[task]'),
  cmd('tasks', 'tasks', 'Show background tasks', '/tasks'),
  cmd('yolo', 'yolo', 'Toggle YOLO (auto-approve) mode', '/yolo'),
  cmd('auto', 'auto', 'Toggle auto permission mode', '/auto'),
  cmd('usage', 'usage', 'Show token/quota usage', '/usage'),
  cmd('status', 'status', 'Show Kimi runtime status', '/status'),
  cmd('compact', 'compact', 'Compact the conversation context', '/compact'),
  cmd('undo', 'undo', 'Undo the last turn', '/undo'),
  cmd('help', 'help', 'Show Kimi slash command help', '/help'),
  cmd('exit', 'exit', 'Close the current chat tab', '/exit'),
];
