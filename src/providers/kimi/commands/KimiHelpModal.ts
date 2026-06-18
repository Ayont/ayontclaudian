import { App, Modal } from 'obsidian';

const COMMANDS: Array<{ name: string; description: string }> = [
  { name: '/new', description: 'Start a new Kimi session' },
  { name: '/fork', description: 'Fork the current session' },
  { name: '/sessions', description: 'Browse and resume Kimi sessions' },
  { name: '/model', description: 'Switch the current model' },
  { name: '/goal', description: 'Set a standing goal' },
  { name: '/skill:<name>', description: 'Invoke a Kimi skill' },
  { name: '/plan', description: 'Enter plan mode' },
  { name: '/swarm', description: 'Start a Kimi agent swarm' },
  { name: '/tasks', description: 'Show background tasks' },
  { name: '/compact', description: 'Compress context' },
  { name: '/undo', description: 'Undo the last turn' },
  { name: '/usage', description: 'Show quota usage' },
  { name: '/status', description: 'Show Kimi status' },
  { name: '/help', description: 'Show this help' },
  { name: '/exit', description: 'Close the current tab' },
];

export class KimiHelpModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: 'Kimi Code CLI Commands' });
    const list = contentEl.createEl('div', { cls: 'kimi-help-list' });
    for (const cmd of COMMANDS) {
      const row = list.createEl('div', { cls: 'kimi-help-row' });
      row.createEl('code', { text: cmd.name });
      row.createEl('span', { text: cmd.description });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
