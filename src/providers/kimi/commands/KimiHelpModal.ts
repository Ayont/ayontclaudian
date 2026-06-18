import type { App } from 'obsidian';
import { Modal } from 'obsidian';

interface CommandEntry {
  name: string;
  description: string;
  category: string;
}

const COMMANDS: CommandEntry[] = [
  { name: '/new', description: 'Start a new Kimi session', category: 'Session' },
  { name: '/fork', description: 'Fork the current session', category: 'Session' },
  { name: '/sessions', description: 'Browse and resume Kimi sessions', category: 'Session' },
  { name: '/model', description: 'Switch the current model', category: 'Session' },

  { name: '/login', description: 'Log in to Kimi via the CLI', category: 'Auth' },
  { name: '/logout', description: 'Log out of Kimi via the CLI', category: 'Auth' },

  { name: '/goal', description: 'Set a standing goal', category: 'Agentic' },
  { name: '/skill:<name>', description: 'Invoke a Kimi skill', category: 'Agentic' },
  { name: '/plan', description: 'Toggle plan mode', category: 'Modes' },
  { name: '/yolo', description: 'Toggle YOLO (auto-approve) mode', category: 'Modes' },
  { name: '/auto', description: 'Toggle auto permission mode', category: 'Modes' },
  { name: '/swarm', description: 'Start a Kimi agent swarm', category: 'Agentic' },
  { name: '/tasks', description: 'Show background tasks', category: 'Agentic' },

  { name: '/compact', description: 'Compress context', category: 'Utility' },
  { name: '/undo', description: 'Undo the last turn', category: 'Utility' },
  { name: '/usage', description: 'Show quota usage', category: 'Utility' },
  { name: '/status', description: 'Show Kimi status', category: 'Utility' },

  { name: '/help', description: 'Show this help', category: 'UI' },
  { name: '/exit', description: 'Close the current tab', category: 'UI' },
];

const CATEGORY_ORDER = ['Session', 'Auth', 'Modes', 'Agentic', 'Utility', 'UI'];

export class KimiHelpModal extends Modal {
  constructor(
    app: App,
    private readonly currentGoal?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('kimi-help-modal');

    const header = contentEl.createDiv({ cls: 'kimi-help-header' });
    header.createEl('h2', { text: 'Kimi code CLI commands', cls: 'kimi-help-title' });
    header.createEl('p', {
      text: 'Slash commands available in the kimi chat.',
      cls: 'kimi-help-subtitle',
    });

    if (this.currentGoal?.trim()) {
      const goalCard = contentEl.createDiv({ cls: 'kimi-goal-card' });
      goalCard.createEl('span', { text: 'Current goal', cls: 'kimi-goal-label' });
      goalCard.createEl('span', { text: this.currentGoal.trim(), cls: 'kimi-goal-text' });
    }

    const grouped = this.groupByCategory(COMMANDS);
    for (const category of CATEGORY_ORDER) {
      const items = grouped.get(category);
      if (!items || items.length === 0) {
        continue;
      }

      const section = contentEl.createDiv({ cls: 'kimi-help-section' });
      section.createEl('h3', { text: category, cls: 'kimi-help-section-title' });

      const list = section.createEl('div', { cls: 'kimi-help-list' });
      for (const cmd of items) {
        const row = list.createEl('div', { cls: 'kimi-help-row' });
        row.createEl('code', { text: cmd.name, cls: 'kimi-help-command' });
        row.createEl('span', { text: cmd.description, cls: 'kimi-help-description' });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private groupByCategory(commands: CommandEntry[]): Map<string, CommandEntry[]> {
    const map = new Map<string, CommandEntry[]>();
    for (const cmd of commands) {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return map;
  }
}
