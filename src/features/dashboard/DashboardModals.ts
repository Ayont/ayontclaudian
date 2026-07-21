import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import { DEFAULT_USAGE_WINDOW_HOURS, type ProviderWindow } from '../../core/budget/tokenBudget';
import type { MissionEvent, MissionState } from '../../core/intelligence/multiAgent/MissionStateStorage';
import { loadMemoryNotes } from '../../core/memory/memoryService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type { ProviderId } from '../../core/types/provider';
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
      const schedule = wf.trigger.schedule?.cron ?? wf.trigger.event?.type ?? wf.trigger.type;
      const next = wf.nextRun ? new Date(wf.nextRun).toLocaleString('de-DE') : '—';
      card.createEl('p', { cls: 'claudian-browser-card-content', text: `Trigger: ${schedule} · Nächster Lauf: ${next}` });
      const actions = card.createDiv({ cls: 'claudian-browser-card-actions' });
      const run = actions.createEl('button', { text: 'Jetzt ausführen' });
      run.addEventListener('click', () => {
        run.disabled = true;
        void this.plugin.workflowEngine.run(wf.id)
          .then(() => new Notice(`Workflow ausgeführt: ${wf.name}`))
          .finally(() => { run.disabled = false; });
      });
      const toggle = actions.createEl('button', { text: wf.enabled ? 'Pausieren' : 'Aktivieren' });
      toggle.addEventListener('click', () => {
        this.plugin.workflowEngine.setEnabled(wf.id, !wf.enabled);
        this.onOpen();
      });
      const remove = actions.createEl('button', { text: 'Löschen' });
      remove.addEventListener('click', () => {
        this.plugin.workflowEngine.unregister(wf.id);
        this.onOpen();
      });
    }
  }
}

// ── Verbrauch & Limits Modal ─────────────────────────────────────────────────

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/** 38.400 → „38,4k" · 1.200.000 → „1,2M" — deutsches Dezimalkomma. */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })}k`;
  return String(Math.round(value));
}

/** 8.040.000 ms → „2 h 14 min" · „43 min" · „< 1 min". */
function formatDuration(ms: number): string {
  if (ms < MS_PER_MINUTE) return '< 1 min';
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  if (hours === 0) return `${minutes} min`;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/**
 * „Verbrauch & Limits": per-provider rate-limit windows with a fill bar and a
 * live reset countdown.
 *
 * What we show is MEASURED locally: the plugin sees every turn's token report
 * (input/context tokens) and aggregates it. Official provider caps depend on
 * the user's plan and are not queryable — so window length + cap are editable
 * per provider, and without a cap we show plain consumption, no made-up %.
 */
export class TokenUsageModal extends Modal {
  private tickTimer: number | null = null;

  constructor(app: App, private readonly plugin: ClaudianPlugin) {
    super(app);
    this.modalEl.addClass('claudian-dashboard-browser-modal');
    applyProviderTheme(this.modalEl, plugin);
  }

  onOpen(): void {
    this.renderContent();
    // Countdown ticks live while the modal is open.
    this.tickTimer = window.setInterval(() => this.renderContent(), 30_000);
  }

  onClose(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.contentEl.empty();
  }

  private renderContent(): void {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: 'claudian-browser-header' });
    setIcon(header.createSpan({ cls: 'claudian-browser-icon' }), 'gauge');
    header.createEl('h2', { text: 'Verbrauch & Limits' });

    contentEl.createEl('p', {
      cls: 'claudian-usage-hint',
      text: 'Gemessen wird der Token-Verbrauch deiner Chats in dieser App (Input-/Kontext-Tokens, wie vom Provider gemeldet). Offizielle Limits hängen von deinem Plan ab und sind nicht abfragbar — trage Fenster und Limit pro Provider ein, um Füllstand und Restmenge zu sehen. Das Fenster startet mit der ersten Nachricht und resettet komplett (Claude-Code-Modell).',
    });

    const tracker = this.plugin.tokenBudgetTracker;
    const settings = this.plugin.settings;
    const windows = tracker.getWindowedProviders(settings.usageWindowHours ?? {});
    const state = tracker.getState();
    const weekTotal = windows.reduce((sum, w) => sum + w.weekTokens, 0);

    // ── Totals ────────────────────────────────────────────────────────
    const totals = contentEl.createDiv({ cls: 'claudian-usage-totals' });
    this.renderTotal(totals, 'Heute', state.dailyTotal);
    this.renderTotal(totals, '7 Tage', weekTotal);
    this.renderTotal(totals, 'Session', state.sessionTotal);

    // ── Provider cards ────────────────────────────────────────────────
    if (windows.length === 0) {
      contentEl.createEl('p', {
        cls: 'claudian-usage-empty',
        text: 'Noch keine Verbrauchsdaten — schick eine Nachricht, dann erscheinen hier Fenster, Reset-Countdown und Tages-/Wochensummen.',
      });
    }

    for (const win of windows) {
      this.renderProviderCard(contentEl, win);
    }

    // ── Reset ─────────────────────────────────────────────────────────
    const actions = contentEl.createDiv({ cls: 'claudian-usage-actions' });
    const resetBtn = actions.createEl('button', { cls: 'claudian-usage-reset-btn', text: 'Statistik zurücksetzen' });
    resetBtn.addEventListener('click', () => {
      tracker.resetSession();
      tracker.resetDaily();
      this.plugin.persistTokenUsage();
      new Notice('Verbrauchsstatistik zurückgesetzt.');
      this.renderContent();
    });
  }

  private renderTotal(parent: HTMLElement, label: string, value: number): void {
    const card = parent.createDiv({ cls: 'claudian-usage-total-card' });
    card.createSpan({ cls: 'claudian-usage-total-label', text: label });
    card.createSpan({ cls: 'claudian-usage-total-value', text: formatTokens(value) });
  }

  private renderProviderCard(parent: HTMLElement, win: ProviderWindow): void {
    const settings = this.plugin.settings;
    const windowHours = settings.usageWindowHours?.[win.providerId] ?? DEFAULT_USAGE_WINDOW_HOURS;
    const cap = settings.usageTokenCaps?.[win.providerId] ?? 0;

    const card = parent.createDiv({ cls: 'claudian-usage-provider-card' });

    // Head: provider name + inline window/cap editors
    const head = card.createDiv({ cls: 'claudian-usage-provider-head' });
    head.createSpan({ cls: 'claudian-usage-provider-name', text: ProviderRegistry.getProviderDisplayName(win.providerId as ProviderId) });

    const editors = head.createDiv({ cls: 'claudian-usage-editors' });
    this.renderNumberEditor(editors, 'Fenster', windowHours, 'h', (value) => {
      settings.usageWindowHours = { ...(settings.usageWindowHours ?? {}), [win.providerId]: value };
      void this.plugin.saveSettings().then(() => this.renderContent());
    });
    this.renderNumberEditor(editors, 'Limit', cap, 'Tokens', (value) => {
      settings.usageTokenCaps = { ...(settings.usageTokenCaps ?? {}), [win.providerId]: value };
      void this.plugin.saveSettings().then(() => this.renderContent());
    });

    // Consumption line + optional fill bar
    const pct = cap > 0 ? Math.min(100, Math.round((win.tokens / cap) * 100)) : null;
    const consumption = card.createDiv({ cls: 'claudian-usage-consumption' });
    consumption.createSpan({
      cls: 'claudian-usage-consumption-value',
      text: cap > 0
        ? `${formatTokens(win.tokens)} / ${formatTokens(cap)} Tokens`
        : `${formatTokens(win.tokens)} Tokens`,
    });
    consumption.createSpan({
      cls: 'claudian-usage-consumption-sub',
      text: cap > 0
        ? `${pct}% im ${windowHours}-h-Fenster · noch ${formatTokens(Math.max(0, cap - win.tokens))}`
        : `im ${windowHours}-h-Fenster · ${win.runs} Turns`,
    });

    if (cap > 0 && pct !== null) {
      const bar = card.createDiv({ cls: 'claudian-usage-limit-bar' });
      const fill = bar.createDiv({ cls: 'claudian-usage-limit-fill' });
      fill.style.width = `${pct}%`;
      if (pct >= 100) fill.addClass('is-error');
      else if (pct >= 80) fill.addClass('is-warn');
    }

    // Meta: reset countdown + day/week sums
    const meta = card.createDiv({ cls: 'claudian-usage-provider-meta' });
    const now = Date.now();
    const resetChip = meta.createSpan({ cls: 'claudian-usage-reset-chip' });
    if (win.resetAt !== null && win.resetAt > now) {
      resetChip.setText(`↻ Reset in ${formatDuration(win.resetAt - now)}`);
    } else {
      resetChip.setText('Fenster frei');
      resetChip.addClass('is-free');
    }
    meta.createSpan({
      cls: 'claudian-usage-provider-sums',
      text: `Heute ${formatTokens(win.todayTokens)} · 7 Tage ${formatTokens(win.weekTokens)}`,
    });
  }

  private renderNumberEditor(
    parent: HTMLElement,
    label: string,
    value: number,
    suffix: string,
    onCommit: (value: number) => void,
  ): void {
    const wrap = parent.createSpan({ cls: 'claudian-usage-editor' });
    wrap.createSpan({ cls: 'claudian-usage-editor-label', text: label });
    const input = wrap.createEl('input', { cls: 'claudian-usage-editor-input' });
    input.type = 'number';
    input.min = '0';
    input.value = value > 0 ? String(value) : '';
    input.placeholder = suffix === 'Tokens' ? 'aus' : String(DEFAULT_USAGE_WINDOW_HOURS);
    input.addEventListener('change', () => {
      const parsed = Number.parseInt(input.value, 10);
      onCommit(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
    });
    wrap.createSpan({ cls: 'claudian-usage-editor-suffix', text: suffix });
  }
}
