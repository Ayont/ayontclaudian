import type { App } from 'obsidian';
import { Modal, Notice, setIcon } from 'obsidian';

import type { MissionEvent, MissionState } from '../../core/intelligence/multiAgent/MissionStateStorage';
import { loadMemoryNotes } from '../../core/memory/memoryService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../main';
import { renderUsageCostSection } from '../settings/ui/UsageCostSection';

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

// ── Verbrauch & Kosten Modal ─────────────────────────────────────────────────

/**
 * „Verbrauch & Kosten": the usage & cost center in a modal.
 *
 * What we show is MEASURED locally: the plugin sees every turn's token report
 * and aggregates it. Official provider caps depend on the user's plan and are
 * not queryable — window, cap and prices are therefore editable per provider.
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
    header.createEl('h2', { text: 'Verbrauch & Kosten' });

    contentEl.createEl('p', {
      cls: 'claudian-usage-hint',
      text: 'Gemessen wird der Token-Verbrauch deiner Chats in dieser App, so wie ihn der jeweilige Provider meldet. Offizielle Limits hängen von deinem Plan ab und sind nicht abfragbar — trage Fenster, Limit und Preise pro Provider ein, um Füllstand und Kosten zu sehen.',
    });

    // Same surface as the settings panel — one implementation, two entry points.
    renderUsageCostSection(contentEl, this.plugin);
  }
}
