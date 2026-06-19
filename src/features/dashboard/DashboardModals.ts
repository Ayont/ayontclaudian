import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import type { MissionEvent, MissionState } from '../../core/intelligence/multiAgent/MissionStateStorage';
import type ClaudianPlugin from '../../main';

// ── Memory Browser Modal ──────────────────────────────────────────────────────

interface MemoryFact {
  topic: string;
  content: string;
  confidence: number;
}

export class MemoryBrowserModal extends Modal {
  private facts: MemoryFact[] = [];
  private listEl: HTMLElement | null = null;
  private searchEl: HTMLInputElement | null = null;

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'brain-circuit');
    header.createEl('h2', { text: 'Memory Browser' });

    const searchWrap = contentEl.createDiv({ cls: 'claudian-browser-search' });
    this.searchEl = searchWrap.createEl('input', {
      type: 'text',
      placeholder: 'Search memories...',
      cls: 'claudian-browser-search-input',
    });
    this.searchEl.addEventListener('input', () => this.renderList());

    this.listEl = contentEl.createDiv({ cls: 'claudian-browser-list' });

    const loadingEl = this.listEl.createEl('p', { cls: 'claudian-browser-empty', text: 'Loading...' });
    try {
      this.facts = await this.plugin.agenticMemoryService.recall({ limit: 50 });
    } catch {
      this.facts = [];
    }
    loadingEl.remove();
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const query = this.searchEl?.value.toLowerCase().trim() ?? '';
    const filtered = query
      ? this.facts.filter(f =>
          f.topic.toLowerCase().includes(query) || f.content.toLowerCase().includes(query))
      : this.facts;

    if (filtered.length === 0) {
      this.listEl.createEl('p', { cls: 'claudian-browser-empty', text: query ? 'No matches.' : 'No memories yet.' });
      return;
    }

    for (const fact of filtered) {
      const card = this.listEl.createDiv({ cls: 'claudian-browser-card' });
      const head = card.createDiv({ cls: 'claudian-browser-card-head' });
      head.createEl('span', { cls: 'claudian-browser-card-title', text: fact.topic });
      const conf = head.createSpan({ cls: 'claudian-browser-card-badge' });
      conf.setText(`${(fact.confidence * 100).toFixed(0)}%`);
      if (fact.confidence > 0.8) conf.addClass('claudian-browser-card-badge--high');
      card.createEl('p', { cls: 'claudian-browser-card-content', text: fact.content.slice(0, 300) });
    }
  }
}

// ── Mission Log Browser Modal ─────────────────────────────────────────────────

export class MissionLogBrowserModal extends Modal {
  private missions: MissionState[] = [];
  private eventsByMission = new Map<string, MissionEvent[]>();
  private listEl: HTMLElement | null = null;

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'scroll-text');
    header.createEl('h2', { text: 'Mission Log' });

    this.listEl = contentEl.createDiv({ cls: 'claudian-browser-list' });

    const loadingEl = this.listEl.createEl('p', { cls: 'claudian-browser-empty', text: 'Loading...' });
    try {
      this.missions = await this.plugin.missionStateStorage.listMissions();
      for (const mission of this.missions) {
        const events = await this.plugin.missionStateStorage.loadEvents(mission.taskId);
        this.eventsByMission.set(mission.taskId, events);
      }
    } catch {
      this.missions = [];
    }
    loadingEl.remove();
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.missions.length === 0) {
      this.listEl.createEl('p', { cls: 'claudian-browser-empty', text: 'No mission history yet.' });
      return;
    }

    for (const mission of this.missions) {
      const events = this.eventsByMission.get(mission.taskId) ?? [];
      const card = this.listEl.createDiv({ cls: 'claudian-browser-card claudian-mission-card' });
      const head = card.createDiv({ cls: 'claudian-browser-card-head' });
      head.createEl('span', { cls: 'claudian-browser-card-title', text: mission.prompt.slice(0, 80) });
      const statusBadge = head.createSpan({ cls: 'claudian-browser-card-badge' });
      statusBadge.setText(mission.status);
      if (mission.status === 'completed') statusBadge.addClass('claudian-browser-card-badge--high');
      if (mission.status === 'error') statusBadge.addClass('claudian-browser-card-badge--error');

      const meta = card.createDiv({ cls: 'claudian-mission-meta' });
      meta.createSpan({ text: `${mission.agentIds.length} agents` });
      meta.createSpan({ text: `${mission.overall}%` });
      meta.createSpan({ text: new Date(mission.createdAt).toLocaleString() });

      if (events.length > 0) {
        const eventsEl = card.createDiv({ cls: 'claudian-mission-events' });
        for (const event of events.slice(0, 10)) {
          const row = eventsEl.createDiv({ cls: `claudian-mission-event claudian-mission-event--${event.type}` });
          row.createSpan({ cls: 'claudian-mission-event-time', text: new Date(event.ts).toLocaleTimeString() });
          row.createSpan({ cls: 'claudian-mission-event-text', text: event.message });
        }
      }
    }
  }
}

// ── Workflow Browser Modal ────────────────────────────────────────────────────

export class WorkflowBrowserModal extends Modal {
  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'workflow');
    header.createEl('h2', { text: 'Workflow Browser' });

    const workflows = this.plugin.workflowEngine.list();
    const listEl = contentEl.createDiv({ cls: 'claudian-browser-list' });

    if (workflows.length === 0) {
      listEl.createEl('p', { cls: 'claudian-browser-empty', text: 'No workflows yet.' });
      return;
    }

    for (const wf of workflows) {
      const card = listEl.createDiv({ cls: 'claudian-browser-card' });
      const head = card.createDiv({ cls: 'claudian-browser-card-head' });
      head.createEl('span', { cls: 'claudian-browser-card-title', text: wf.name });
      const badge = head.createSpan({ cls: 'claudian-browser-card-badge' });
      badge.setText(wf.enabled ? 'enabled' : 'disabled');
      if (wf.enabled) badge.addClass('claudian-browser-card-badge--high');
      card.createEl('p', { cls: 'claudian-browser-card-content', text: `Trigger: ${wf.trigger.type}` });
    }
  }
}

// ── Token Usage Chart Modal ───────────────────────────────────────────────────

export class TokenUsageModal extends Modal {
  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'gauge');
    header.createEl('h2', { text: 'Token Usage' });

    const usage = this.plugin.tokenBudgetTracker.getState();
    const stats = contentEl.createDiv({ cls: 'claudian-usage-stats' });

    this.createStatCard(stats, 'Daily Total', usage.dailyTotal.toLocaleString(), 'tokens');
    this.createStatCard(stats, 'Session Total', usage.sessionTotal.toLocaleString(), 'tokens');

    // Canvas-rendered mini bar chart
    const chartWrap = contentEl.createDiv({ cls: 'claudian-usage-chart-wrap' });
    chartWrap.createEl('h3', { text: 'Usage Breakdown' });
    const canvas = chartWrap.createEl('canvas', { cls: 'claudian-usage-chart' });
    canvas.width = 500;
    canvas.height = 200;
    this.drawBarChart(canvas, [
      { label: 'Daily', value: usage.dailyTotal, color: '#60a5fa' },
      { label: 'Session', value: usage.sessionTotal, color: '#a78bfa' },
    ]);

    const actions = contentEl.createDiv({ cls: 'claudian-usage-actions' });
    const resetBtn = actions.createEl('button', { cls: 'claudian-usage-reset-btn', text: 'Reset Session' });
    resetBtn.addEventListener('click', () => {
      this.plugin.tokenBudgetTracker.resetSession();
      this.plugin.tokenBudgetTracker.resetDaily();
      new Notice('Token budget reset.');
      this.onOpen();
    });
  }

  private createStatCard(parent: HTMLElement, title: string, value: string, subtitle: string): void {
    const card = parent.createDiv({ cls: 'claudian-usage-stat-card' });
    card.createEl('span', { cls: 'claudian-usage-stat-title', text: title });
    card.createEl('span', { cls: 'claudian-usage-stat-value', text: value });
    card.createEl('span', { cls: 'claudian-usage-stat-sub', text: subtitle });
  }

  private drawBarChart(canvas: HTMLCanvasElement, bars: { label: string; value: number; color: string }[]): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const padding = 40;
    const barWidth = (w - padding * 2) / bars.length - 20;
    const maxValue = Math.max(...bars.map(b => b.value), 1);

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding + ((h - padding * 2) / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }

    // Bars
    bars.forEach((bar, i) => {
      const x = padding + i * (barWidth + 20) + 10;
      const barHeight = ((h - padding * 2) * bar.value) / maxValue;
      const y = h - padding - barHeight;

      ctx.fillStyle = bar.color;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Label
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bar.label, x + barWidth / 2, h - padding + 20);

      // Value
      ctx.fillStyle = 'var(--text-normal)';
      ctx.fillText(bar.value.toLocaleString(), x + barWidth / 2, y - 8);
    });
  }
}
