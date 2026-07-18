import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';

import { type ClaudianEvent, type ClaudianEventType, globalEventBus } from '../../core/events/EventBus';
import { loadMemoryNotes } from '../../core/memory/memoryService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ProviderCapabilities, ProviderId } from '../../core/providers/types';
import type ClaudianPlugin from '../../main';
import { animateNumber } from '../../utils/animateNumber';
import { ArtifactGalleryModal } from '../artifacts/ArtifactGalleryModal';
import { MemoryBrowserModal, MissionLogBrowserModal, TokenUsageModal, WorkflowBrowserModal } from './DashboardModals';

export const VIEW_TYPE_CLAUDIAN_DASHBOARD = 'claudian-dashboard';

interface DashboardCard {
  id: string;
  title: string;
  icon: string;
  value: string;
  numericValue?: number;
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

interface FeatureStatusItem {
  icon: string;
  label: string;
  detail: string;
  active: boolean;
  value: string;
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
  private readonly lastCardValues = new Map<string, number>();

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
    this.lastCardValues.clear();

    // Tint the whole dashboard with the active provider's brand color so it
    // feels like one cohesive, intentional surface per provider.
    this.applyProviderTheme(container);

    this.renderHeader(container);
    this.renderSectionHeading(container, 'Systemübersicht', 'Live-Zustand deines Agent-Workspace');
    this.gridEl = container.createDiv({ cls: 'claudian-dashboard-grid' });
    await this.refreshCards();
    this.renderProviderCapabilities(container);
    this.renderFeatureMap(container);
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

  // ── Provider theming ────────────────────────────────────────────────────────

  /** Resolves the provider whose brand color should tint the dashboard. */
  private getActiveProviderId(): ProviderId {
    return (
      this.plugin.getView()?.getActiveTab()?.providerId ??
      ProviderRegistry.resolveSettingsProviderId(this.plugin.settings)
    );
  }

  private renderProviderCapabilities(parent: HTMLElement): void {
    const activeProviderId = this.getActiveProviderId();
    const capabilities = ProviderRegistry.getCapabilities(activeProviderId);
    const enabledProviders = ProviderRegistry.getEnabledProviderIds(this.plugin.settings);

    this.renderSectionHeading(parent, 'Provider-Fähigkeiten', 'Was dein aktiver Runtime-Provider direkt unterstützt');
    const panel = parent.createDiv({ cls: 'claudian-dashboard-capabilities' });

    const providerRail = panel.createDiv({ cls: 'claudian-dashboard-provider-rail' });
    providerRail.createSpan({ cls: 'claudian-dashboard-provider-rail-label', text: 'Aktivierte Provider' });
    const providerList = providerRail.createDiv({ cls: 'claudian-dashboard-provider-list' });
    for (const providerId of enabledProviders) {
      const chip = providerList.createSpan({ cls: 'claudian-dashboard-provider-item' });
      chip.dataset.provider = providerId;
      chip.toggleClass('is-active', providerId === activeProviderId);
      chip.createSpan({ cls: 'claudian-dashboard-provider-item-dot' });
      chip.createSpan({ text: this.getProviderLabel(providerId) });
      if (providerId === activeProviderId) chip.createSpan({ cls: 'claudian-dashboard-provider-item-current', text: 'aktiv' });
    }

    const capabilityGrid = panel.createDiv({ cls: 'claudian-dashboard-capability-grid' });
    for (const item of this.getCapabilityItems(capabilities)) {
      const row = capabilityGrid.createDiv({ cls: 'claudian-dashboard-capability' });
      row.toggleClass('is-supported', item.supported);
      setIcon(row.createSpan({ cls: 'claudian-dashboard-capability-icon' }), item.icon);
      const copy = row.createDiv({ cls: 'claudian-dashboard-capability-copy' });
      copy.createSpan({ cls: 'claudian-dashboard-capability-label', text: item.label });
      copy.createSpan({ cls: 'claudian-dashboard-capability-state', text: item.supported ? 'Verfügbar' : 'Nicht unterstützt' });
      setIcon(row.createSpan({ cls: 'claudian-dashboard-capability-check' }), item.supported ? 'check' : 'minus');
    }
  }

  private getCapabilityItems(capabilities: ProviderCapabilities): Array<{ label: string; icon: string; supported: boolean }> {
    return [
      { label: 'Bilder & Vision', icon: 'image', supported: capabilities.supportsImageAttachments },
      { label: 'Plan Mode', icon: 'list-checks', supported: capabilities.supportsPlanMode },
      { label: 'MCP Tools', icon: 'plug', supported: capabilities.supportsMcpTools },
      { label: 'Multi-Agent', icon: 'users', supported: capabilities.supportsMultiAgent },
      { label: 'Rewind', icon: 'history', supported: capabilities.supportsRewind },
      { label: 'Fork', icon: 'git-fork', supported: capabilities.supportsFork },
      { label: 'Instructions', icon: 'message-square-code', supported: capabilities.supportsInstructionMode },
      { label: 'Live Steering', icon: 'route', supported: capabilities.supportsTurnSteer === true },
    ];
  }

  private renderFeatureMap(parent: HTMLElement): void {
    const workflows = this.plugin.workflowEngine.list();
    const ragSize = this.plugin.vectorStore.size();
    const hasVisionProvider = ProviderRegistry.getEnabledProviderIds(this.plugin.settings)
      .some((providerId) => ProviderRegistry.getCapabilities(providerId).supportsImageAttachments);
    const features: FeatureStatusItem[] = [
      { icon: 'route', label: 'Model Router', detail: 'Wählt automatisch das passende Modell', active: this.plugin.settings.modelRouterEnabled === true, value: this.plugin.settings.modelRouterEnabled ? 'Aktiv' : 'Aus' },
      { icon: 'brain-circuit', label: 'Agent Memory', detail: 'Erinnert projektbezogene Fakten', active: this.plugin.settings.memoryEnabled !== false, value: this.plugin.settings.memoryEnabled === false ? 'Aus' : 'Aktiv' },
      { icon: 'search', label: 'Vault RAG', detail: 'Semantischer Kontext aus deinem Vault', active: ragSize > 0, value: ragSize > 0 ? `${ragSize} Chunks` : 'Nicht indexiert' },
      { icon: 'scan-eye', label: 'Vision', detail: 'Analysiert Bilder und Screenshots', active: hasVisionProvider, value: hasVisionProvider ? 'Bereit' : 'Kein Provider' },
      { icon: 'bot', label: 'Auto Mode', detail: 'Führt lange Ziele unbeaufsichtigt fort', active: this.plugin.settings.autoMode === true, value: this.plugin.settings.autoMode ? 'Aktiv' : 'Aus' },
      { icon: 'file-diff', label: 'Diff Preview', detail: 'Zeigt Änderungen vor der Freigabe', active: this.plugin.settings.diffPreviewBeforeWrites !== false, value: this.plugin.settings.diffPreviewBeforeWrites === false ? 'Aus' : 'Aktiv' },
      { icon: 'shield-check', label: 'Token Guard', detail: 'Überwacht Session- und Tagesbudget', active: this.plugin.settings.tokenBudgetEnabled === true, value: this.plugin.settings.tokenBudgetEnabled ? 'Aktiv' : 'Aus' },
      { icon: 'workflow', label: 'Workflows', detail: 'Zeit- und eventgesteuerte Automationen', active: workflows.some((workflow) => workflow.enabled), value: `${workflows.filter((workflow) => workflow.enabled).length}/${workflows.length} aktiv` },
    ];

    this.renderSectionHeading(parent, 'Feature Map', 'Deine wichtigsten Claudian-Systeme auf einen Blick');
    const map = parent.createDiv({ cls: 'claudian-dashboard-feature-map', attr: { role: 'list' } });
    for (const feature of features) {
      const row = map.createDiv({ cls: 'claudian-dashboard-feature', attr: { role: 'listitem' } });
      row.toggleClass('is-active', feature.active);
      setIcon(row.createSpan({ cls: 'claudian-dashboard-feature-icon' }), feature.icon);
      const copy = row.createDiv({ cls: 'claudian-dashboard-feature-copy' });
      copy.createSpan({ cls: 'claudian-dashboard-feature-label', text: feature.label });
      copy.createSpan({ cls: 'claudian-dashboard-feature-detail', text: feature.detail });
      row.createSpan({ cls: 'claudian-dashboard-feature-value', text: feature.value });
    }
  }

  /** Applies the active provider's brand color via the `data-provider` hook. */
  private applyProviderTheme(container: HTMLElement): void {
    container.dataset.provider = this.getActiveProviderId();
  }

  // ── Header + live indicator ────────────────────────────────────────────────

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: 'claudian-dashboard-header' });
    const titleGroup = header.createDiv({ cls: 'claudian-dashboard-title-group' });

    const icon = titleGroup.createSpan({ cls: 'claudian-dashboard-logo' });
    setIcon(icon, 'bot');

    const textGroup = titleGroup.createDiv({ cls: 'claudian-dashboard-text-group' });
    textGroup.createEl('h2', { text: 'Claudian OS' });
    textGroup.createEl('p', { text: 'Dein Agenten-Arbeitsbereich für den Vault' });

    const status = header.createDiv({ cls: 'claudian-dashboard-status' });

    // Provider chip — names the brand currently coloring the dashboard.
    const providerId = this.getActiveProviderId();
    const providerChip = status.createSpan({ cls: 'claudian-dashboard-provider-chip' });
    providerChip.dataset.provider = providerId;
    const providerDot = providerChip.createSpan({ cls: 'claudian-dashboard-provider-dot' });
    void providerDot;
    providerChip.createSpan({ text: this.getProviderLabel(providerId) });
    providerChip.setAttribute('aria-label', `Aktiver Provider: ${this.getProviderLabel(providerId)}`);

    const statusDot = status.createSpan({ cls: 'claudian-dashboard-status-dot claudian-dashboard-status-dot--active' });
    void statusDot;
    this.liveBadgeEl = status.createSpan({ cls: 'claudian-dashboard-live', text: 'Aktiv' });
    this.updateLiveBadge();
  }

  private renderSectionHeading(parent: HTMLElement, title: string, detail: string): void {
    const heading = parent.createDiv({ cls: 'claudian-dashboard-section-heading' });
    heading.createEl('h3', { text: title });
    heading.createSpan({ text: detail });
  }

  /** Human-readable provider name for the header chip. */
  private getProviderLabel(providerId: string): string {
    try {
      return ProviderRegistry.getProviderDisplayName(providerId) ?? providerId;
    } catch {
      return providerId;
    }
  }

  private updateLiveBadge(): void {
    if (!this.liveBadgeEl) return;
    if (this.liveMissions > 0) {
      this.liveBadgeEl.setText(`${this.liveMissions} Mission${this.liveMissions > 1 ? 'en' : ''} aktiv`);
      this.liveBadgeEl.addClass('claudian-dashboard-live--running');
    } else {
      this.liveBadgeEl.setText('Aktiv');
      this.liveBadgeEl.removeClass('claudian-dashboard-live--running');
    }
  }

  // ── Stat cards ─────────────────────────────────────────────────────────────

  private async refreshCards(): Promise<void> {
    if (!this.gridEl) return;
    const grid = this.gridEl;
    grid.empty();

    const projects = await this.plugin.projectService.listProjects();
    // Memories live in two stores: chat memory notes (v1, settings.memoryFolder)
    // and agentic facts (v2). The card shows the REAL combined total — not the
    // length of a limit-1 recall.
    const memoryFolder = this.plugin.settings.memoryFolder ?? '.claudian/memory';
    const [memories, factCount, chatNotes] = await Promise.all([
      this.plugin.agenticMemoryService.recall({ limit: 1 }),
      this.plugin.agenticMemoryService.count(),
      loadMemoryNotes(this.app.vault, memoryFolder).catch(() => []),
    ]);
    const memoryTotal = factCount + chatNotes.length;
    const latestMemoryTopic = memories[0]?.topic ?? chatNotes[0]?.topic ?? null;
    const usage = this.plugin.tokenBudgetTracker.getState();
    const ragSize = this.plugin.vectorStore.size();
    const workflows = this.plugin.workflowEngine.list();
    const agents = this.plugin.multiAgentService.listAgents();

    const cards: DashboardCard[] = [
      {
        id: 'projects', title: 'Projekte', icon: 'folder-kanban',
        value: String(projects.length), numericValue: projects.length,
        subtitle: projects[0] ? `Zuletzt: ${projects[0].name}` : 'Noch keine Projekte',
        status: projects.length > 0 ? 'ok' : 'info', action: 'Erstellen',
        onClick: () => this.plugin.createClaudianProject(),
      },
      {
        id: 'memory', title: 'Erinnerungen', icon: 'brain-circuit',
        value: String(memoryTotal), numericValue: memoryTotal,
        subtitle: latestMemoryTopic ? `Zuletzt: ${latestMemoryTopic}` : 'Noch keine Erinnerungen',
        status: memoryTotal > 0 ? 'ok' : 'info', action: 'Öffnen',
        onClick: () => this.openMemoryBrowser(),
      },
      {
        id: 'usage', title: 'Token-Verbrauch', icon: 'gauge',
        value: usage.dailyTotal.toLocaleString(), numericValue: usage.dailyTotal,
        subtitle: `Sitzung: ${usage.sessionTotal.toLocaleString()} Tokens`,
        status: usage.dailyTotal > 100_000 ? 'warning' : 'ok', action: 'Zurücksetzen',
        onClick: () => {
          this.plugin.tokenBudgetTracker.resetSession();
          this.plugin.tokenBudgetTracker.resetDaily();
          new Notice('Token-Budget zurückgesetzt.');
          void this.refreshCards();
        },
      },
      {
        id: 'rag', title: 'RAG-Index', icon: 'search',
        value: String(ragSize), numericValue: ragSize,
        subtitle: ragSize > 0 ? 'Vault-Chunks indexiert' : 'Noch nicht indexiert',
        status: ragSize > 0 ? 'ok' : 'warning', action: 'Indexieren',
        onClick: () => this.plugin.indexVaultRAG(),
      },
      {
        id: 'workflows', title: 'Workflows', icon: 'workflow',
        value: String(workflows.length), numericValue: workflows.length,
        subtitle: workflows.length > 0 ? 'Geplante Automationen' : 'Noch keine Workflows',
        status: workflows.length > 0 ? 'ok' : 'info', action: 'Anzeigen',
        onClick: () => this.openWorkflowBrowser(),
      },
      {
        id: 'agents', title: 'Agenten', icon: 'users',
        value: String(agents.length), numericValue: agents.length,
        subtitle: this.liveMissions > 0 ? `${this.liveMissions} laufen gerade` : 'Spezialisten bereit',
        status: 'accent', action: 'Starten',
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

    const previousValue = card.numericValue !== undefined
      ? this.lastCardValues.get(card.id) ?? 0
      : undefined;
    const valueEl = el.createEl('div', {
      cls: 'claudian-dashboard-card-value',
      text: previousValue !== undefined ? previousValue.toLocaleString() : card.value,
    });
    if (card.numericValue !== undefined) {
      animateNumber(valueEl, card.numericValue, { from: previousValue });
      this.lastCardValues.set(card.id, card.numericValue);
    }
    el.createEl('h3', { cls: 'claudian-dashboard-card-title', text: card.title });
    el.createEl('p', { cls: 'claudian-dashboard-card-subtitle', text: card.subtitle });

    el.addEventListener('click', () => {
      void (async (): Promise<void> => {
        try {
          await card.onClick();
        } catch (error) {
          new Notice(`Dashboard-Aktion fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
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
    this.renderSectionHeading(parent, 'Schnellaktionen', 'Häufige Aufgaben ohne Umwege');
    const actions = parent.createDiv({ cls: 'claudian-dashboard-actions' });

    const indexBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(indexBtn.createSpan(), 'search');
    indexBtn.createSpan({ text: 'Vault-RAG indexieren' });
    indexBtn.addEventListener('click', () => void this.plugin.indexVaultRAG());

    const multiBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn claudian-dashboard-action-btn--primary' });
    setIcon(multiBtn.createSpan(), 'users');
    multiBtn.createSpan({ text: 'Multi-Agent starten' });
    multiBtn.addEventListener('click', () => this.plugin.runMultiAgentTask());

    const projectBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(projectBtn.createSpan(), 'folder-kanban');
    projectBtn.createSpan({ text: 'Neues Projekt' });
    projectBtn.addEventListener('click', () => void this.plugin.createClaudianProject());

    const missionLogBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(missionLogBtn.createSpan(), 'scroll-text');
    missionLogBtn.createSpan({ text: 'Missions-Log' });
    missionLogBtn.addEventListener('click', () => void this.openMissionLogBrowser());

    const usageBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(usageBtn.createSpan(), 'gauge');
    usageBtn.createSpan({ text: 'Token-Verbrauch' });
    usageBtn.addEventListener('click', () => this.openTokenUsageModal());

    const artifactBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(artifactBtn.createSpan(), 'layout-dashboard');
    artifactBtn.createSpan({ text: 'Artefakte' });
    artifactBtn.addEventListener('click', () => new ArtifactGalleryModal(this.app, this.plugin).open());

    const refreshBtn = actions.createEl('button', { cls: 'claudian-dashboard-action-btn' });
    setIcon(refreshBtn.createSpan(), 'refresh-cw');
    refreshBtn.createSpan({ text: 'Aktualisieren' });
    refreshBtn.addEventListener('click', () => {
      void (async (): Promise<void> => {
        refreshBtn.disabled = true;
        refreshBtn.addClass('is-loading');
        refreshBtn.setAttribute('aria-busy', 'true');
        try {
          await this.refreshCards();
          refreshBtn.querySelector('span:last-child')?.setText('Aktualisiert');
          window.setTimeout(() => refreshBtn.querySelector('span:last-child')?.setText('Aktualisieren'), 1200);
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.removeClass('is-loading');
          refreshBtn.removeAttribute('aria-busy');
        }
      })();
    });
  }

  // ── Live activity feed ──────────────────────────────────────────────────────

  private renderActivityFeed(parent: HTMLElement): void {
    this.renderSectionHeading(parent, 'Aktivität', 'Ereignisse aus Missionen, Memory und Workflows');
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
