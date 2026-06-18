import type { KimiProviderState } from '../types';

export interface KimiSlashCommandUI {
  openSessionList(): void;
  openHelp(): void;
  closeTab(): void;
}

export interface KimiSlashCommandResult {
  consumed: boolean;
  followUpPrompt?: string;
  authAction?: 'login' | 'logout';
}

const SLASH_RE = /^\/([a-zA-Z0-9_-]+)(?::(\S+))?(?:\s+(.*))?$/;

export class KimiSlashCommandHandler {
  constructor(
    private readonly getState: () => KimiProviderState,
    private readonly updateState: (state: KimiProviderState) => void,
    private readonly ui: KimiSlashCommandUI,
  ) {}

  async execute(input: string): Promise<KimiSlashCommandResult> {
    const match = input.match(SLASH_RE);
    if (!match) {
      return { consumed: false };
    }
    const [, name] = match;

    switch (name.toLowerCase()) {
      case 'new':
        this.updateState({ sessionId: undefined, goal: undefined, forkParentId: undefined });
        return { consumed: true, followUpPrompt: 'Starting a new Kimi session.' };

      case 'fork': {
        const parentId = this.getState().sessionId;
        if (!parentId) {
          return { consumed: true, followUpPrompt: 'No active session to fork. Start a session first.' };
        }
        this.updateState({ sessionId: undefined, forkParentId: parentId });
        return { consumed: true, followUpPrompt: `Forked from session ${parentId}. Starting a fresh branch.` };
      }

      case 'sessions':
        this.ui.openSessionList();
        return { consumed: true };

      case 'login':
        return { consumed: true, authAction: 'login' };

      case 'logout':
        return { consumed: true, authAction: 'logout' };

      case 'model':
        // Native model picker lives in the chat toolbar; let Kimi handle /model in print mode.
        return { consumed: false };

      case 'help':
        this.ui.openHelp();
        return { consumed: true };

      case 'exit':
        this.ui.closeTab();
        return { consumed: true };

      case 'goal':
      case 'skill':
      case 'plan':
      case 'yolo':
      case 'auto':
      case 'swarm':
      case 'tasks':
      case 'compact':
      case 'undo':
      case 'usage':
      case 'status':
        // Pass through to Kimi CLI; these are already surfaced in the dropdown.
        return { consumed: false };

      default:
        return { consumed: false };
    }
  }
}
