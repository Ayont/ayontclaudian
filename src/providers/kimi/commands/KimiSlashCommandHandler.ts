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

export interface KimiSlashCommandOptions {
  /**
   * Whether the CLI runs `/compact` in print mode. The legacy kimi-cli does
   * (soul slash commands); kimi-code 2.1.0 only parses `/goal` headless and
   * would hand `/compact` to the model as ordinary text.
   */
  runsSlashCompact?: () => boolean;
}

const HEADLESS_COMPACT_NOTE = 'Kimi verdichtet den Kontext im Druckmodus selbst, sobald das Fenster voll wird. '
  + 'Für eine sofortige Verdichtung „Mit weniger Kontext fortsetzen“ in der Kontextwarnung nutzen '
  + 'oder in den Kimi-Einstellungen den ACP-Modus aktivieren, der /compact direkt ausführt.';

const SLASH_RE = /^\/([a-zA-Z0-9_-]+)(?::(\S+))?(?:\s+(.*))?$/;

export class KimiSlashCommandHandler {
  constructor(
    private readonly getState: () => KimiProviderState,
    private readonly updateState: (state: KimiProviderState) => void,
    private readonly ui: KimiSlashCommandUI,
    private readonly options: KimiSlashCommandOptions = {},
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
      case 'compact':
        if (this.options.runsSlashCompact && !this.options.runsSlashCompact()) {
          return { consumed: true, followUpPrompt: HEADLESS_COMPACT_NOTE };
        }
        return { consumed: false };

      case 'swarm':
      case 'tasks':
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
