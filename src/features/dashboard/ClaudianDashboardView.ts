import { ItemView, type WorkspaceLeaf } from 'obsidian';

import type ClaudianPlugin from '../../main';

export const VIEW_TYPE_CLAUDIAN_DASHBOARD = 'claudian-dashboard';

export class ClaudianDashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN_DASHBOARD;
  }

  getDisplayText(): string {
    return 'Claudian OS Dashboard';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('claudian-dashboard');

    container.createEl('h2', { text: 'Claudian OS Dashboard' });

    const grid = container.createDiv({ cls: 'claudian-dashboard-grid' });

    const projects = await this.plugin.projectService.listProjects();
    this.createCard(grid, 'Projects', `${projects.length} project(s) configured. Latest: ${projects[0]?.name ?? 'none'}.`);

    const memories = await this.plugin.agenticMemoryService.recall({ limit: 1 });
    this.createCard(grid, 'Memory', `${memories.length}+ fact(s) stored. Latest: ${memories[0]?.topic ?? 'none'}.`);

    const usage = this.plugin.tokenBudgetTracker.getState();
    this.createCard(grid, 'Usage', `Today: ${usage.dailyTotal.toLocaleString()} tokens. Session: ${usage.sessionTotal.toLocaleString()} tokens.`);

    this.createCard(grid, 'RAG Index', `${this.plugin.vectorStore.size()} chunk(s) indexed.`);
    this.createCard(grid, 'Workflows', `${this.plugin.workflowEngine.list().length} workflow(s) registered.`);
    this.createCard(grid, 'Agents', `${this.plugin.multiAgentService.listAgents().length} specialist agent(s) available.`);
  }

  private createCard(parent: HTMLElement, title: string, description: string): void {
    const card = parent.createDiv({ cls: 'claudian-dashboard-card' });
    card.createEl('h3', { text: title });
    card.createEl('p', { text: description });
  }
}
