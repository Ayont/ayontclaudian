import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';

import { type ClaudianEvent, type ClaudianEventType, globalEventBus } from '../../core/events/EventBus';
import type ClaudianPlugin from '../../main';
import { MemoryBrowserModal, MissionLogBrowserModal, TokenUsageModal, WorkflowBrowserModal } from './DashboardModals';

export const VIEW_TYPE_CLAUDIAN_DASHBOARD = 'claudian-dashboard';

interface DashboardCard {
  id: string;
  title: string;
  icon: string;
  value: string;
  subtitle: string;
  status: 'ok' | 'info' | 'warning' | 'accent';
  action: string;
  onClick: () => void | Promise<void>;
}

interface ActivityItem {
  ts: number;
  icon: string;
  text: string;
  kind: 'mission' | 'agent' | 'memory' | 'workflow' | 'project' | 'vault';
}

/** Stats refresh cadence while the dashboard is open. */
const REFRESH_INTERVAL_MS = 5000;
const MAX_ACTIVITY_ITEMS = 30;

export class ClaudianDashboardView extends ItemView {
  private gridEl: HTMLElement | null = null;
  private feedEl: HTMLElement | null = null;
  private liveBadgeEl: HTMLElement | null = null;
  private readonly activity: ActivityItem[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private refreshTimer: number | null = null;
  private liveMissions = 0;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ClaudianPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDIAN_DASHBOARD;
  }

  getDisplayText(): string {
    return 'Claudian OS Dashboard';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('claudian-dashboard');

    this.renderHeader(container);
    this.gridEl = container.createDiv({ cls: 'claudian-dashboard-grid' });
    await this.refreshCards();
    this.renderActions(container);
    this.renderActivityFeed(container);

    this.subscribeToEvents();
    this.startAutoRefresh();
  }

  async onClose(): Promise<void> {
    this.stopAutoRefresh();
    for (const off of this.unsubscribers) off();
    this.unsubscribers.length = 0;
  }

  // ── Header + live indicator ────────────────────────────────────────────────

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: 'claudian-dashboard-header' });
    const titleGroup = header.createDiv({ cls: 'claudian-dashboard-title-group' });

    const icon = titleGroup.createSpan({ cls: 'claudian-dashboard-logo' });
    setIcon(icon, 'bot');

    const textGroup = titleGroup.createDiv({ cls: 'claudian-dashboard-text-group' });
    textGroup.createEl('h2', { text: 'Claudian OS' });
    textGroup.createEl('p', { text: 'Agent operating system for your vault' });

    const status = header.createDiv({ cls: 'claudian-dashboard-status' });
    const statusDot = status.createSpan({ cls: 'claudian-dashboard-status-dot claudian-dashboard-status-dot--active' });
    void statusDot;
    this.liveBadgeEl = status.createSpan({ cls: 'claudian-dashboard-live', text: 'Active' });
    this.updateLiveBadge();
  }

  private updateLiveBadge(): void {
    if (!this.liveBadgeEl) return;
    if (this.liveMissions > 0) {
      this.liveBadgeEl.setText(`${this.liveMissions} Mission${this.liveMissions > 1 ? 'en' : ''} aktiv`);
      this.liveBadgeEl.addClass('claudian-dashboard-live--running');
    } else {
      this.liveBadgeEl.setText('Active');
      this.liveBadgeEl.removeClass('claudian-dashboard-live--running');
    }
  }

  // ── Stat cards ─────────────────────────────────────────────────────────────

  private async refreshCards(): Promise<void> {
    if (!this.gridEl) return;
    const grid = this.gridEl;
    grid.empty();

    const projects = await this.plugin.projectService.listProjects();
    const memories = await this.plugin.agenticMemoryService.recall({ limit: 1 });
    const usage = this.plugin.tokenBudgetTracker.getState();
    const ragSize = this.plugin.vectorStore.size();
    const workflows = this.plugin.workflowEngine.list();
    const agents = this.plugin.multiAgentService.listAgents();

    const cards: DashboardCard[] = [
      {
        id: 'projects', title: 'Projects', icon: 'folder-kanban',
        value: String(projects.length),
        subtitle: projects[0] ? `Latest: ${projects[0].name}` : 'No projects yet',
        status: projects.length > 0 ? 'ok' : 'info', action: 'Create',
        onClick: () => this.plugin.createClaudianProject(),
      },
      {
        id: 'memory', title: 'Memory', icon: 'brain-circuit',
        value: `${memories.length}+`,
        subtitle: memories[0] ? `Latest: ${memories[0].topic}` : 'No memories yet',
        status: memories.length > 0 ? 'ok' : 'info', action: 'Recall',
        onClick: () => this.openMemoryBrowser(),
      },
      {
        id: 'usage', title: 'Token Usage', icon: 'gauge',
        value: usage.dailyTotal.toLocaleString(),
        subtitle: `Session: ${usage.sessionTotal.toLocaleString()} tokens`,
        status: usage.dailyTotal > 100_000 ? 'warning' : 'ok', action: 'Reset',
        onClick: () => {
          this.plugin.tokenBudgetTracker.resetSession();
          this.plugin.tokenBudgetTracker.resetDaily();
          new Notice('Token budget reset.');
          void this.refreshCards();
        },
      },
      {
        id: 'rag', title: 'RAG Index', icon: 'search',
        value: String(ragSize),
        subtitle: ragSize > 0 ? 'Vault chunks indexed' : 'Not indexed yet',
        status: ragSize > 0 ? 'ok' : 'warning', action: 'Index',
        onClick: () => this.plugin.indexVaultRAG(),
      },
      {
        id: 'workflows', title: 'Workflows', icon: 'workflow',
        value: String(workflows.length),
        subtitle: workflows.length > 0 ? 'Scheduled automations' : 'No workflows yet',
        status: workflows.length > 0 ? 'ok' : 'info', action: 'View',
        onClick: () => this.openWorkflowBrowser(),
      },
      {
        id: 'agents', title: 'Agents', icon: 'users',
        value: String(agents.length),
        subtitle: this.liveMissions > 0 ? `${this.liveMissions} running now` : 'Specialist agents available',
        status: 'accent', action: 'Run',
        onClick: () => this.plugin.runMultiAgentTask(),
      },
    ];

    for (const card of cards) this.createCard(grid, card);
  }

  private createCard(parent: HTMLElement, card: DashboardCard): void {
    const el = parent.createDiv({ cls: `claudian-dashboard-card claudian-dashboard-card--${card.status}` });
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    const header = el.createDiv({ cls: 'claudian-dashboard-card-header' });
    setIcon(header.createSpan({ cls: 'claudian-dashboard-card-icon' }), card.icon);
    header.createEl('span', { cls: 'claudian-dashboard-card-action', text: card.action });

    el.createEl('div', { cls: 'claudian-dashboard-card-value', text: card.value });
    el.createEl('h3', { cls: 'claudian-dashboard-card-title', text: card.title });
    el.createEl('p', { cls: 'claudian-dashboard-card-subtitle', text: card.subtitle });

    el.addEventListener('click', () => {
      void (async (): Promise<void> => {
        try {
          await card.onClick();
        } catch (error) {
          new Notice(`Dashboard action failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  }

  private renderActions(parent: HTMLElement): void {
    const actions = parent.createDiv({ cls: 'claudian-dashboard-actions' });

    const indexBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(indexBtn.createSpan(), 'search');
    indexBtn.createSpan({ text: 'Index Vault RAG' });
    indexBtn.addEventListener('click', () => void this.plugin.indexVaultRAG());

    const multiBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn claudian-dashboard-action-btn--primary' });
    setIcon(multiBtn.createSpan(), 'users');
    multiBtn.createSpan({ text: 'Run Multi-Agent' });
    multiBtn.addEventListener('click', () => this.plugin.runMultiAgentTask());

    const projectBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(projectBtn.createSpan(), 'folder-kanban');
    projectBtn.createSpan({ text: 'New Project' });
    projectBtn.addEventListener('click', () => void this.plugin.createClaudianProject());

    const missionLogBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(missionLogBtn.createSpan(), 'scroll-text');
    missionLogBtn.createSpan({ text: 'Mission Log' });
    missionLogBtn.addEventListener('click', () => void this.openMissionLogBrowser());

    const usageBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(usageBtn.createSpan(), 'gauge');
    usageBtn.createSpan({ text: 'Token Usage' });
    usageBtn.addEventListener('click', () => this.openTokenUsageModal());

    const refreshBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(refreshBtn.createSpan(), 'refresh-cw');
    refreshBtn.createSpan({ text: 'Refresh' });
    refreshBtn.addEventListener('click', () => void this.refreshCards());
  }

  // ── Live activity feed ──────────────────────────────────────────────────────

  private renderActivityFeed(parent: HTMLElement): void {
    const section = parent.createDiv({ cls: 'claudian-dashboard-activity' });
    const head = section.createDiv({ cls: 'claudian-dashboard-activity-head' });
    setIcon(head.createSpan(), 'activity');
    head.createEl('h3', { text: 'Live-Aktivität' });
    this.feedEl = section.createDiv({ cls: 'claudian-dashboard-activity-feed' });
    this.renderFeed();
  }

  private renderFeed(): void {
    if (!this.feedEl) return;
    this.feedEl.empty();
    if (this.activity.length === 0) {
      this.feedEl.createEl('p', { cls: 'claudian-dashboard-activity-empty', text: 'Noch keine Aktivität — starte eine Mission oder indexiere den Vault.' });
      return;
    }
    for (const item of this.activity) {
      const row = this.feedEl.createDiv({ cls: `claudian-dashboard-activity-item claudian-dashboard-activity-item--${item.kind}` });
      setIcon(row.createSpan({ cls: 'claudian-dashboard-activity-icon' }), item.icon);
      row.createSpan({ cls: 'claudian-dashboard-activity-text', text: item.text });
      row.createSpan({ cls: 'claudian-dashboard-activity-time', text: this.relativeTime(item.ts) });
    }
  }

  private pushActivity(item: ActivityItem): void {
    this.activity.unshift(item);
    if (this.activity.length > MAX_ACTIVITY_ITEMS) this.activity.length = MAX_ACTIVITY_ITEMS;
    this.renderFeed();
  }

  private relativeTime(ts: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `vor ${secs}s`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `vor ${mins}m`;
    return `vor ${Math.round(mins / 60)}h`;
  }

  // ── Event wiring + auto-refresh ──────────────────────────────────────────────

  private subscribeToEvents(): void {
    const on = <T,>(type: ClaudianEventType, handler: (e: ClaudianEvent<T>) => void): void => {
      this.unsubscribers.push(globalEventBus.on<T>(type, handler));
    };

    on<{ prompt?: string; agents?: number }>('mission:started', (e) => {
      this.liveMissions += 1;
      this.updateLiveBadge();
      this.pushActivity({ ts: e.timestamp, icon: 'rocket', kind: 'mission', text: `Mission gestartet (${e.payload.agents ?? '?'} Agents)` });
    });
    on<{ ok?: boolean; agents?: number }>('mission:completed', (e) => {
      this.liveMissions = Math.max(0, this.liveMissions - 1);
      this.updateLiveBadge();
      this.pushActivity({
        ts: e.timestamp,
        icon: e.payload.ok ? 'check-circle' : 'alert-circle',
        kind: 'mission',
        text: e.payload.ok ? `Mission abgeschlossen (${e.payload.agents ?? 0} Agents)` : 'Mission fehlgeschlagen',
      });
      void this.refreshCards();
    });
    on<{ id?: string; type?: string; agentId?: string; message?: string }>('mission:event', (e) => {
      const { type, agentId, message } = e.payload;
      const prefix = agentId ? `[${agentId}] ` : '';
      this.pushActivity({
        ts: e.timestamp,
        icon: type?.includes('error') ? 'alert-circle' : 'activity',
        kind: 'mission',
        text: `Mission event: ${prefix}${message ?? type ?? 'unknown'}`,
      });
    });
    on<{ topic?: string }>('memory:updated', (e) => {
      this.pushActivity({ ts: e.timestamp, icon: 'brain-circuit', kind: 'memory', text: `Memory aktualisiert${e.payload.topic ? `: ${e.payload.topic}` : ''}` });
    });
    on<{ name?: string }>('workflow:trigger', (e) => {
      this.pushActivity({ ts: e.timestamp, icon: 'workflow', kind: 'workflow', text: `Workflow ausgelöst${e.payload.name ? `: ${e.payload.name}` : ''}` });
    });
    on<{ name?: string }>('project:switched', (e) => {
      this.pushActivity({ ts: e.timestamp, icon: 'folder-kanban', kind: 'project', text: `Projekt gewechselt${e.payload.name ? `: ${e.payload.name}` : ''}` });
    });
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    this.refreshTimer = window.setInterval(() => {
      // Keep relative timestamps fresh; refresh stats only when idle to avoid churn.
      this.renderFeed();
      if (this.liveMissions === 0) void this.refreshCards();
    }, REFRESH_INTERVAL_MS);
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ── Browsers (interactive modals) ───────────────────────────────────────────

  private async openMissionLogBrowser(): Promise<void> {
    new MissionLogBrowserModal(this.app, this.plugin).open();
  }

  private openMemoryBrowser(): void {
    new MemoryBrowserModal(this.app, this.plugin).open();
  }

  private openWorkflowBrowser(): void {
    new WorkflowBrowserModal(this.app, this.plugin).open();
  }

  private openTokenUsageModal(): void {
    new TokenUsageModal(this.app, this.plugin).open();
  }
}
