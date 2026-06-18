import type { KimiProviderState } from '../types';

export interface KimiSlashCommandUI {
  openSessionList(): void;
  openModelPicker(): void;
  openHelp(): void;
  closeTab(): void;
}

export interface KimiSlashCommandResult {
  consumed: boolean;
  followUpPrompt?: string;
}

const SLASH_RE = /^\/([a-zA-Z0-9_-]+)(?::(\S+))?(?:\s+(.*))?$/;

export class KimiSlashCommandHandler {
  constructor(
    private readonly getState: () => KimiProviderState,
    private readonly updateState: (state: KimiProviderState) => void,
    private readonly ui: KimiSlashCommandUI,
    private readonly followUp: (prompt: string) => void,
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
        this.followUp('Starting a new Kimi session.');
        return { consumed: true };

      case 'fork': {
        const parentId = this.getState().sessionId;
        if (!parentId) {
          this.followUp('No active session to fork. Start a session first.');
          return { consumed: true };
        }
        this.updateState({ sessionId: undefined, forkParentId: parentId });
        this.followUp(`Forked from session ${parentId}. Starting a fresh branch.`);
        return { consumed: true };
      }

      case 'sessions':
        this.ui.openSessionList();
        return { consumed: true };

      case 'model':
        this.ui.openModelPicker();
        return { consumed: true };

      case 'help':
        this.ui.openHelp();
        return { consumed: true };

      case 'exit':
        this.ui.closeTab();
        return { consumed: true };

      case 'goal':
      case 'skill':
      case 'plan':
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
