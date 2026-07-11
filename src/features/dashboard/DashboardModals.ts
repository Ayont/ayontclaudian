import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import type { MissionEvent, MissionState } from '../../core/intelligence/multiAgent/MissionStateStorage';
import { loadMemoryNotes } from '../../core/memory/memoryService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../main';

/**
 * Tints a dashboard modal with the active provider's brand color via the shared
 * `[data-provider]` CSS hook, so every dashboard surface matches the provider.
 */
function applyProviderTheme(modalEl: HTMLElement, plugin: ClaudianPlugin): void {
  try {
    modalEl.dataset.provider =
      plugin.getView()?.getActiveTab()?.providerId ??
      ProviderRegistry.resolveSettingsProviderId(plugin.settings);
  } catch {
    // Non-fatal: modal still renders with the default accent.
  }
}

// ── Memory Browser Modal ──────────────────────────────────────────────────────

/** Unified view over both memory stores: chat notes (v1) and agentic facts (v2). */
interface MemoryBrowserEntry {
  source: 'chat' | 'fact';
  topic: string;
  content: string;
  tags: string[];
  /** Only facts carry a confidence. */
  confidence?: number;
  /** Epoch ms; 0 when unknown. */
  updatedAt: number;
}

export class MemoryBrowserModal extends Modal {
  private entries: MemoryBrowserEntry[] = [];
  private listEl: HTMLElement | null = null;
  private searchEl: HTMLInputElement | null = null;
  private countEl: HTMLElement | null = null;

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
    applyProviderTheme(this.modalEl, plugin);
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'brain-circuit');
    header.createEl('h2', { text: 'Memory Browser' });
    this.countEl = header.createSpan({ cls: 'claudian-browser-header-count' });

    const searchWrap = contentEl.createDiv({ cls: 'claudian-browser-search' });
    this.searchEl = searchWrap.createEl('input', {
      type: 'text',
      placeholder: 'Memories durchsuchen…',
      cls: 'claudian-browser-search-input',
    });
    this.searchEl.addEventListener('input', () => this.renderList());

    this.listEl = contentEl.createDiv({ cls: 'claudian-browser-list' });

    const loadingEl = this.listEl.createEl('p', { cls: 'claudian-browser-empty', text: 'Loading...' });
    this.entries = await this.loadEntries();
    loadingEl.remove();
    this.renderList();
  }

  /** Merges chat memory notes and agentic facts, newest first. */
  private async loadEntries(): Promise<MemoryBrowserEntry[]> {
    const memoryFolder = this.plugin.settings.memoryFolder ?? '.claudian/memory';
    const [facts, chatNotes] = await Promise.all([
      this.plugin.agenticMemoryService.recall({ limit: 200 }).catch(() => []),
      loadMemoryNotes(this.app.vault, memoryFolder).catch(() => []),
    ]);

    const entries: MemoryBrowserEntry[] = [
      ...facts.map((fact): MemoryBrowserEntry => ({
        source: 'fact',
        topic: fact.topic,
        content: fact.content,
        tags: fact.tags,
        confidence: fact.confidence,
        updatedAt: fact.updatedAt,
      })),
      ...chatNotes.map((note): MemoryBrowserEntry => ({
        source: 'chat',
        topic: note.topic,
        content: note.content,
        tags: note.tags,
        updatedAt: note.mtime,
      })),
    ];

    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const query = this.searchEl?.value.toLowerCase().trim() ?? '';
    const filtered = query
      ? this.entries.filter(e =>
          e.topic.toLowerCase().includes(query)
          || e.content.toLowerCase().includes(query)
          || e.tags.some(tag => tag.toLowerCase().includes(query)))
      : this.entries;

    this.countEl?.setText(query
      ? `${filtered.length}/${this.entries.length}`
      : `${this.entries.length}`);

    if (filtered.length === 0) {
      const empty = this.listEl.createDiv({ cls: 'claudian-browser-empty-state' });
      setIcon(empty.createSpan({ cls: 'claudian-browser-empty-icon' }), query ? 'search-x' : 'brain-circuit');
      empty.createEl('p', {
        cls: 'claudian-browser-empty',
        text: query ? 'Keine Treffer.' : 'Noch keine Memories.',
      });
      if (!query) {
        empty.createEl('p', {
          cls: 'claudian-browser-empty-hint',
          text: 'Text markieren → Command „Store memory" oder „Remember fact".',
        });
      }
      return;
    }

    for (const entry of filtered) {
      const card = this.listEl.createDiv({ cls: 'claudian-browser-card claudian-memory-card' });
      const head = card.createDiv({ cls: 'claudian-browser-card-head' });

      const sourceBadge = head.createSpan({
        cls: `claudian-memory-source claudian-memory-source--${entry.source}`,
      });
      sourceBadge.setText(entry.source === 'fact' ? 'Fact' : 'Chat');

      head.createEl('span', { cls: 'claudian-browser-card-title', text: entry.topic });

      if (entry.confidence !== undefined) {
        const conf = head.createSpan({ cls: 'claudian-browser-card-badge' });
        conf.setText(`${(entry.confidence * 100).toFixed(0)}%`);
        if (entry.confidence > 0.8) conf.addClass('claudian-browser-card-badge--high');
      }

      card.createEl('p', { cls: 'claudian-browser-card-content', text: entry.content.slice(0, 300) });

      if (entry.tags.length > 0 || entry.updatedAt > 0) {
        const meta = card.createDiv({ cls: 'claudian-memory-card-meta' });
        for (const tag of entry.tags.slice(0, 6)) {
          meta.createSpan({ cls: 'claudian-memory-tag', text: tag });
        }
        if (entry.updatedAt > 0) {
          meta.createSpan({
            cls: 'claudian-memory-date',
            text: new Date(entry.updatedAt).toLocaleDateString('de-DE', {
              day: '2-digit', month: '2-digit', year: 'numeric',
            }),
          });
        }
      }
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
    applyProviderTheme(this.modalEl, plugin);
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
    applyProviderTheme(this.modalEl, plugin);
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
    applyProviderTheme(this.modalEl, plugin);
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
    const accent = this.resolveAccent();
    this.drawBarChart(canvas, [
      { label: 'Daily', value: usage.dailyTotal, color: accent.strong },
      { label: 'Session', value: usage.sessionTotal, color: accent.soft },
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

  /**
   * Resolves the active provider's accent into concrete canvas colors. Canvas
   * cannot consume CSS custom properties, so we read the computed `--claudian-*`
   * tokens (set via `[data-provider]`) and fall back to sensible defaults.
   */
  private resolveAccent(): { strong: string; soft: string; grid: string; text: string; muted: string } {
    const styles = getComputedStyle(this.modalEl);
    const accent = styles.getPropertyValue('--claudian-accent').trim() || '#7c3aed';
    const rgb = styles.getPropertyValue('--claudian-accent-rgb').trim();
    const text = styles.getPropertyValue('--text-normal').trim() || '#e6e6e6';
    const muted = styles.getPropertyValue('--text-muted').trim() || '#9a9a9a';
    return {
      strong: accent,
      soft: rgb ? `rgba(${rgb}, 0.5)` : accent,
      grid: rgb ? `rgba(${rgb}, 0.12)` : 'rgba(255,255,255,0.1)',
      text,
      muted,
    };
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
    const accent = this.resolveAccent();

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = accent.grid;
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
      ctx.fillStyle = accent.muted;
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bar.label, x + barWidth / 2, h - padding + 20);

      // Value
      ctx.fillStyle = accent.text;
      ctx.fillText(bar.value.toLocaleString(), x + barWidth / 2, y - 8);
    });
  }
}
