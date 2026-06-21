import { Modal, Notice, setIcon } from 'obsidian';

import { globalEventBus } from '../../core/events/EventBus';
import type {
  AgentProgress,
  MissionProgress,
  SynthesisContribution,
} from '../../core/intelligence/multiAgent/MultiAgentService';
import { ProviderRegistry } from '../../core/providers/ProviderRegistry';
import type ClaudianPlugin from '../../main';

interface AgentCardRefs {
  card: HTMLElement;
  statusEl: HTMLElement;
  progressBar: HTMLElement;
  metaEl: HTMLElement;
  outputEl: HTMLElement;
  startedAt: number | null;
}

/**
 * Multi-Agent Mission control: the user types a task, a team of specialists runs
 * it in parallel with live streaming + token/time metrics, and a lead coordinator
 * synthesizes one final answer. Emits mission events on the global bus so the
 * dashboard reflects activity in real time.
 */
export class MultiAgentModal extends Modal {
  private readonly missionId = `ma-${Date.now()}`;
  private gridEl: HTMLElement | null = null;
  private overallBar: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private promptInput: HTMLTextAreaElement | null = null;
  private launchBtn: HTMLButtonElement | null = null;
  private synthEl: HTMLElement | null = null;
  private synthBodyEl: HTMLElement | null = null;
  private readonly cards = new Map<string, AgentCardRefs>();
  private tickTimer: number | null = null;
  private running = false;
  /** Set when the modal closes; guards async progress callbacks from writing to detached DOM. */
  private closed = false;

  constructor(
    private readonly plugin: ClaudianPlugin,
    private readonly initialPrompt = '',
  ) {
    super(plugin.app);
    this.modalEl.addClass('claudian-multi-agent-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Tint the modal with the active provider's brand color so the mission UI
    // visually matches the provider running the agents.
    const activeProviderId =
      this.plugin.getView()?.getActiveTab()?.providerId ??
      ProviderRegistry.resolveSettingsProviderId(this.plugin.settings);
    this.modalEl.dataset.provider = activeProviderId;
    const providerLabel = this.getProviderLabel(activeProviderId);

    const header = contentEl.createDiv({ cls: 'claudian-multi-agent-header' });
    const titleGroup = header.createDiv({ cls: 'claudian-multi-agent-title-group' });
    const icon = titleGroup.createSpan({ cls: 'claudian-multi-agent-logo' });
    setIcon(icon, 'users');
    const titleCopy = titleGroup.createDiv({ cls: 'claudian-multi-agent-title-copy' });
    titleCopy.createSpan({ cls: 'claudian-multi-agent-eyebrow', text: `${providerLabel} · Mission Control` });
    titleCopy.createEl('h2', { text: 'Multi-Agent Mission' });
    this.statusText = header.createSpan({ cls: 'claudian-multi-agent-status', text: 'Beschreibe die Mission und starte das Team.' });
    this.statusText.setAttribute('role', 'status');
    this.statusText.setAttribute('aria-live', 'polite');

    this.renderPromptSection(contentEl);

    const agents = this.plugin.multiAgentService.listAgents();
    const telemetry = contentEl.createDiv({ cls: 'claudian-multi-agent-telemetry' });
    this.createTelemetryItem(telemetry, 'users', 'Team', `${agents.length} Spezialisten`);
    this.createTelemetryItem(telemetry, 'cpu', 'Runtime', providerLabel);
    this.createTelemetryItem(telemetry, 'keyboard', 'Start', '⌘/Ctrl + Enter');

    this.gridEl = contentEl.createDiv({ cls: 'claudian-multi-agent-grid' });
    this.renderAgentCards();

    const progressWrapper = contentEl.createDiv({ cls: 'claudian-multi-agent-progress' });
    progressWrapper.createSpan({ text: 'Gesamtfortschritt' });
    const barTrack = progressWrapper.createDiv({ cls: 'claudian-multi-agent-progress-track' });
    this.overallBar = barTrack.createDiv({ cls: 'claudian-multi-agent-progress-bar' });
    barTrack.setAttribute('role', 'progressbar');
    barTrack.setAttribute('aria-label', 'Gesamtfortschritt');
    barTrack.setAttribute('aria-valuemin', '0');
    barTrack.setAttribute('aria-valuemax', '100');
    barTrack.setAttribute('aria-valuenow', '0');

    this.synthEl = contentEl.createDiv({ cls: 'claudian-multi-agent-synthesis claudian-hidden' });
    const synthHead = this.synthEl.createDiv({ cls: 'claudian-multi-agent-synthesis-head' });
    const synthIcon = synthHead.createSpan();
    setIcon(synthIcon, 'sparkles');
    synthHead.createEl('h4', { text: 'Synthese' });
    this.synthBodyEl = this.synthEl.createDiv({ cls: 'claudian-multi-agent-synthesis-body' });

    const footer = contentEl.createDiv({ cls: 'claudian-multi-agent-footer' });
    const closeBtn = footer.createEl('button', { text: 'Schließen' });
    closeBtn.addEventListener('click', () => this.close());
  }

  private getProviderLabel(providerId: string): string {
    try {
      return ProviderRegistry.getProviderDisplayName(providerId) ?? providerId;
    } catch {
      return providerId;
    }
  }

  private createTelemetryItem(parent: HTMLElement, iconName: string, label: string, value: string): void {
    const item = parent.createDiv({ cls: 'claudian-multi-agent-telemetry-item' });
    setIcon(item.createSpan({ cls: 'claudian-multi-agent-telemetry-icon' }), iconName);
    const copy = item.createDiv();
    copy.createSpan({ cls: 'claudian-multi-agent-telemetry-label', text: label });
    copy.createSpan({ cls: 'claudian-multi-agent-telemetry-value', text: value });
  }

  onClose(): void {
    // Mark closed so any in-flight mission progress callbacks stop writing to
    // the now-detached DOM. The mission finishes in the background and its
    // result is still saved + a completion event still fires from launch().
    this.closed = true;
    this.stopTicker();
  }

  private renderPromptSection(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: 'claudian-multi-agent-prompt' });
    this.promptInput = wrap.createEl('textarea', {
      cls: 'claudian-multi-agent-prompt-input',
      attr: { rows: '3', placeholder: 'Was soll das Agenten-Team erledigen?' },
    });
    this.promptInput.value = this.initialPrompt;

    this.launchBtn = wrap.createEl('button', { cls: 'claudian-multi-agent-launch' });
    setIcon(this.launchBtn.createSpan(), 'rocket');
    this.launchBtn.createSpan({ text: 'Mission starten' });
    this.launchBtn.addEventListener('click', () => void this.launch());

    this.promptInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void this.launch();
      }
    });
  }

  private renderAgentCards(): void {
    if (!this.gridEl) return;
    this.gridEl.empty();
    this.cards.clear();

    for (const agent of this.plugin.multiAgentService.listAgents()) {
      const card = this.gridEl.createDiv({ cls: 'claudian-multi-agent-card claudian-multi-agent-card--pending' });
      card.setAttribute('data-agent-id', agent.id);

      const avatar = card.createDiv({ cls: 'claudian-multi-agent-avatar' });
      setIcon(avatar.createSpan(), agent.icon ?? 'user');
      const color = agent.color ?? 'var(--interactive-accent)';
      avatar.style.setProperty('--agent-color', color);
      avatar.style.setProperty('--agent-color-rgb', MultiAgentModal.hexToRgb(color) ?? '124, 58, 237');

      const info = card.createDiv({ cls: 'claudian-multi-agent-info' });
      info.createEl('h4', { text: agent.name });
      info.createEl('span', { cls: 'claudian-multi-agent-role', text: agent.role });

      const statusEl = card.createDiv({ cls: 'claudian-multi-agent-card-status', text: 'Bereit' });
      const metaEl = card.createDiv({ cls: 'claudian-multi-agent-card-meta' });

      const progressTrack = card.createDiv({ cls: 'claudian-multi-agent-card-progress-track' });
      const progressBar = progressTrack.createDiv({ cls: 'claudian-multi-agent-card-progress-bar' });
      progressTrack.setAttribute('role', 'progressbar');
      progressTrack.setAttribute('aria-label', `${agent.name} Fortschritt`);
      progressTrack.setAttribute('aria-valuemin', '0');
      progressTrack.setAttribute('aria-valuemax', '100');
      progressTrack.setAttribute('aria-valuenow', '0');

      const outputEl = card.createDiv({ cls: 'claudian-multi-agent-card-output claudian-hidden' });

      this.cards.set(agent.id, { card, statusEl, progressBar, metaEl, outputEl, startedAt: null });
    }
  }

  private async launch(): Promise<void> {
    if (this.running) return;
    const prompt = this.promptInput?.value.trim() ?? '';
    if (!prompt) {
      new Notice('Bitte zuerst eine Mission beschreiben.');
      this.promptInput?.focus();
      return;
    }

    this.running = true;
    this.setControlsDisabled(true);
    this.startTicker();

    const agents = this.plugin.multiAgentService.listAgents();
    const task = { id: this.missionId, prompt, agents: agents.map((a) => a.id) };

    globalEventBus.emit('mission:started', { id: this.missionId, prompt, agents: agents.length });

    try {
      // Use the plugin's full executor so missions launched from the modal get
      // the SAME provider targeting + rate-limit failover as inline missions
      // (executeWithProvider + isRateLimitError). The previous inline executor
      // only had `execute`, silently disabling failover on this entry point.
      const outcome = await this.plugin.multiAgentService.runMission(
        task,
        this.plugin.buildMultiAgentExecutor(),
        {
          synthesize: (taskPrompt, contributions: SynthesisContribution[], onChunk) =>
            this.plugin.runSynthesisPrompt(
              taskPrompt,
              contributions.map((c) => ({ agent: { name: c.agent.name, role: c.agent.role }, output: c.output })),
              onChunk,
            ),
        },
        (progress) => this.updateMissionProgress(progress),
        undefined,
        {
          storage: this.plugin.missionStateStorage,
          onEvent: (event) => globalEventBus.emit('mission:event', { id: this.missionId, ...event }),
          defaultProviderId: this.plugin.getActiveMultiAgentProviderId(),
          resolveAgentProviderId: (agent) => this.plugin.resolveMultiAgentProviderId(agent),
          maxFailovers: 3,
        },
      );

      const content = this.buildResultMarkdown(prompt, outcome.results, outcome.synthesis);
      const filePath = `.claudian/multi-agent-${Date.now()}.md`;
      await this.plugin.app.vault.create(filePath, content);
      new Notice(`Mission gespeichert: ${filePath}`);
      globalEventBus.emit('mission:completed', { id: this.missionId, agents: outcome.results.length, ok: true });
    } catch (error) {
      new Notice(`Mission fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
      globalEventBus.emit('mission:completed', { id: this.missionId, agents: 0, ok: false });
    } finally {
      this.running = false;
      this.stopTicker();
      this.setControlsDisabled(false);
    }
  }

  private updateMissionProgress(progress: MissionProgress): void {
    // Modal was dismissed mid-mission — don't touch detached DOM.
    if (this.closed) return;
    globalEventBus.emit('mission:progress', { id: this.missionId, overall: progress.overall, status: progress.status });

    if (this.overallBar) this.overallBar.style.width = `${progress.overall}%`;
    this.overallBar?.parentElement?.setAttribute('aria-valuenow', String(progress.overall));
    if (this.statusText) {
      const label =
        progress.status === 'synthesizing' ? 'Synthese läuft…'
          : progress.status === 'completed' ? 'Mission abgeschlossen'
            : progress.status === 'error' ? 'Mission mit Fehlern beendet'
              : 'Agenten arbeiten…';
      this.statusText.textContent = label;
      this.statusText.className = `claudian-multi-agent-status claudian-multi-agent-status--${progress.status}`;
    }

    for (const agentProgress of progress.agents) {
      this.updateAgentCard(agentProgress);
    }

    if (progress.synthesis) {
      this.showSynthesis(progress.synthesis.output);
    }
  }

  private updateAgentCard(progress: AgentProgress): void {
    const refs = this.cards.get(progress.agentId);
    if (!refs) return;

    if (progress.status === 'running' && refs.startedAt === null) {
      refs.startedAt = Date.now();
    }
    if (progress.status === 'done' || progress.status === 'error') {
      refs.startedAt = null;
    }

    refs.progressBar.style.width = `${progress.progress}%`;
    refs.progressBar.parentElement?.setAttribute('aria-valuenow', String(progress.progress));
    refs.card.removeClass(
      'claudian-multi-agent-card--pending',
      'claudian-multi-agent-card--running',
      'claudian-multi-agent-card--done',
      'claudian-multi-agent-card--error',
    );
    refs.card.addClass(`claudian-multi-agent-card--${progress.status}`);

    const statusLabel: Record<string, string> = { pending: 'Bereit', running: 'Arbeitet', done: 'Fertig', error: 'Fehler' };
    refs.statusEl.textContent = statusLabel[progress.status] ?? progress.status;

    const tokens = progress.tokens ?? 0;
    const duration = progress.durationMs ? `${(progress.durationMs / 1000).toFixed(1)}s` : this.liveElapsed(refs);
    refs.metaEl.setText(`${tokens} tok${duration ? ` · ${duration}` : ''}`);

    if (progress.output) {
      refs.outputEl.removeClass('claudian-hidden');
      refs.outputEl.textContent = progress.output;
      refs.outputEl.scrollTop = refs.outputEl.scrollHeight;
    }
  }

  private showSynthesis(output: string): void {
    if (!this.synthEl || !this.synthBodyEl) return;
    if (!output) return;
    this.synthEl.removeClass('claudian-hidden');
    this.synthBodyEl.textContent = output;
    this.synthBodyEl.scrollTop = this.synthBodyEl.scrollHeight;
  }

  private liveElapsed(refs: AgentCardRefs): string {
    if (refs.startedAt === null) return '';
    return `${((Date.now() - refs.startedAt) / 1000).toFixed(1)}s`;
  }

  private startTicker(): void {
    this.stopTicker();
    this.tickTimer = window.setInterval(() => {
      for (const refs of this.cards.values()) {
        if (refs.startedAt !== null) {
          const tokens = refs.metaEl.textContent?.split(' tok')[0] ?? '0';
          refs.metaEl.setText(`${tokens} tok · ${this.liveElapsed(refs)}`);
        }
      }
    }, 250);
  }

  private stopTicker(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private setControlsDisabled(disabled: boolean): void {
    if (this.launchBtn) this.launchBtn.disabled = disabled;
    if (this.promptInput) this.promptInput.disabled = disabled;
  }

  private buildResultMarkdown(prompt: string, results: { agentId: string; output: string }[], synthesis: string): string {
    const specialist = results.map((r) => `## ${r.agentId}\n\n${r.output}`).join('\n\n');
    const synthSection = synthesis ? `# Synthese\n\n${synthesis}\n\n` : '';
    return `# Multi-Agent Mission\n\n**Aufgabe:** ${prompt}\n\n${synthSection}---\n\n# Einzelbeiträge\n\n${specialist}`;
  }

  private static hexToRgb(hex: string): string | null {
    const clean = hex.replace('#', '');
    if (clean.length === 3) {
      const r = parseInt(clean[0] + clean[0], 16);
      const g = parseInt(clean[1] + clean[1], 16);
      const b = parseInt(clean[2] + clean[2], 16);
      return `${r}, ${g}, ${b}`;
    }
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    return null;
  }

  /** Opens the mission console, optionally pre-filled with a task prompt. */
  static open(plugin: ClaudianPlugin, initialPrompt = ''): void {
    new MultiAgentModal(plugin, initialPrompt).open();
  }
}
