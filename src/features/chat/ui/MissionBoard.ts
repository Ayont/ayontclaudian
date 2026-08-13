import { setIcon } from 'obsidian';

import type {
  MissionProgress,
  SpecialistAgent,
} from '../../../core/intelligence/multiAgent/MultiAgentService';

interface MissionBoardRow {
  rowEl: HTMLElement;
  statusEl: HTMLElement;
  fillEl: HTMLElement;
  previewEl: HTMLElement;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Bereit',
  running: 'Arbeitet…',
  done: 'Fertig',
  error: 'Fehler',
};

const PREVIEW_MAX_CHARS = 140;

/**
 * Live mission board rendered INSIDE the chat transcript while a team
 * mission runs: one row per agent (status, progress bar, live output
 * preview), an overall bar, and the synthesis streaming in as it is
 * produced. Ephemeral DOM — on completion the caller removes it and appends
 * the persistent markdown summary instead.
 */
export class MissionBoard {
  private readonly rootEl: HTMLElement;
  private readonly overallFillEl: HTMLElement;
  private readonly phaseEl: HTMLElement;
  private readonly rows = new Map<string, MissionBoardRow>();
  private readonly blobs = new Map<string, HTMLElement>();
  private readonly flowDots = new Map<string, HTMLElement>();
  private readonly blobRowEl: HTMLElement;
  private readonly flowEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hubEl: HTMLElement;
  private readonly synthSectionEl: HTMLElement;
  private readonly synthOutputEl: HTMLElement;

  constructor(parentEl: HTMLElement, task: string, agents: SpecialistAgent[]) {
    this.rootEl = parentEl.createDiv({ cls: 'claudian-mission-board' });

    const header = this.rootEl.createDiv({ cls: 'claudian-mission-board-header' });
    const titleEl = header.createDiv({ cls: 'claudian-mission-board-title' });
    setIcon(titleEl.createSpan({ cls: 'claudian-mission-board-icon' }), 'users');
    titleEl.createSpan({ text: 'Team-Mission' });
    header.createDiv({ cls: 'claudian-mission-board-task', text: task });
    this.phaseEl = header.createDiv({ cls: 'claudian-mission-board-phase claudian-hidden' });
    const overallTrack = header.createDiv({ cls: 'claudian-mission-board-overall' });
    this.overallFillEl = overallTrack.createDiv({ cls: 'claudian-mission-board-overall-fill' });

    // Blob strip: each agent is a named, breathing blob; while it works,
    // pulses travel along the flow rail into the synthesis hub — the visible
    // "agents are talking to the lead" layer.
    const blobsEl = this.rootEl.createDiv({ cls: 'claudian-mission-board-blobs' });
    this.blobRowEl = blobsEl.createDiv({ cls: 'claudian-mission-board-blob-row' });
    this.flowEl = blobsEl.createDiv({ cls: 'claudian-mission-board-flow' });
    this.hubEl = blobsEl.createDiv({ cls: 'claudian-mission-board-hub is-pending' });
    setIcon(this.hubEl.createSpan({ cls: 'claudian-mission-board-hub-icon' }), 'sparkles');
    this.hubEl.createSpan({ cls: 'claudian-mission-board-hub-label', text: 'Synthese' });

    this.listEl = this.rootEl.createDiv({ cls: 'claudian-mission-board-list' });
    this.setAgents(agents);

    this.synthSectionEl = this.rootEl.createDiv({
      cls: 'claudian-mission-board-synthesis claudian-hidden',
    });
    const synthHead = this.synthSectionEl.createDiv({ cls: 'claudian-mission-board-synth-head' });
    setIcon(synthHead.createSpan({ cls: 'claudian-mission-board-icon' }), 'sparkles');
    synthHead.createSpan({ text: 'Synthese' });
    this.synthOutputEl = this.synthSectionEl.createDiv({ cls: 'claudian-mission-board-synth-output' });
  }

  /**
   * (Re)builds the agent rows.
   *
   * The board is created before the master prompter has decided who is on the
   * mission, so the roster is replaced once the plan lands — otherwise agents the
   * plan never selected would sit at "Bereit" forever and read as stuck.
   */
  setAgents(agents: SpecialistAgent[]): void {
    this.rows.clear();
    this.blobs.clear();
    this.flowDots.clear();
    this.blobRowEl.empty();
    this.flowEl.empty();
    this.listEl.empty();

    agents.forEach((agent, index) => {
      const blob = this.blobRowEl.createDiv({ cls: 'claudian-mission-board-blob is-pending' });
      if (agent.color) {
        blob.style.setProperty('--mission-agent-color', agent.color);
      }
      blob.createDiv({
        cls: 'claudian-mission-board-blob-circle',
        text: (agent.name.trim()[0] ?? '?').toUpperCase(),
      });
      blob.createDiv({ cls: 'claudian-mission-board-blob-label', text: agent.name });
      this.blobs.set(agent.id, blob);

      const dot = this.flowEl.createDiv({ cls: 'claudian-mission-board-flow-dot' });
      if (agent.color) {
        dot.style.setProperty('--mission-agent-color', agent.color);
      }
      dot.style.animationDelay = `${index * 420}ms`;
      this.flowDots.set(agent.id, dot);

      const rowEl = this.listEl.createDiv({ cls: 'claudian-mission-board-row is-pending' });
      const identityEl = rowEl.createDiv({ cls: 'claudian-mission-board-identity' });
      const dotEl = identityEl.createSpan({ cls: 'claudian-mission-board-dot' });
      if (agent.color) {
        dotEl.style.setProperty('--mission-agent-color', agent.color);
      }
      identityEl.createSpan({ cls: 'claudian-mission-board-name', text: agent.name });
      const meta = agent.model && agent.providerId
        ? `${agent.providerId} · ${agent.model}`
        : agent.role;
      identityEl.createSpan({ cls: 'claudian-mission-board-meta', text: meta });

      const statusEl = rowEl.createDiv({ cls: 'claudian-mission-board-status', text: STATUS_LABELS.pending });
      const trackEl = rowEl.createDiv({ cls: 'claudian-mission-board-track' });
      const fillEl = trackEl.createDiv({ cls: 'claudian-mission-board-fill' });
      const previewEl = rowEl.createDiv({ cls: 'claudian-mission-board-preview' });

      this.rows.set(agent.id, { rowEl, statusEl, fillEl, previewEl });
    });
  }

  /** Shows what the mission is doing before any agent runs (planning, routing). */
  setPhase(label: string | null): void {
    this.phaseEl.setText(label ?? '');
    this.phaseEl.toggleClass('claudian-hidden', !label);
  }

  /** Labels an agent row with the provider its subtask was routed to. */
  setProviderLabels(assignments: Record<string, string>): void {
    for (const [agentId, providerId] of Object.entries(assignments)) {
      const metaEl = this.rows.get(agentId)?.rowEl.querySelector('.claudian-mission-board-meta');
      if (metaEl instanceof HTMLElement) {
        metaEl.setText(providerId);
      }
    }
  }

  /** Applies a mission progress snapshot to the board (idempotent per field). */
  update(progress: MissionProgress): void {
    // scaleX is compositor-friendly; the fill spans the track at scale 1.
    this.overallFillEl.style.transform = `scaleX(${Math.min(1, Math.max(0, progress.overall / 100))})`;

    for (const agent of progress.agents) {
      const row = this.rows.get(agent.agentId);
      if (!row) {
        continue;
      }
      const status = agent.status ?? 'pending';
      for (const el of [row.rowEl, this.blobs.get(agent.agentId)]) {
        if (!el) continue;
        el.classList.toggle('is-pending', status === 'pending');
        el.classList.toggle('is-running', status === 'running');
        el.classList.toggle('is-done', status === 'done');
        el.classList.toggle('is-error', status === 'error');
      }
      // Pulses travel toward the hub only while THIS agent is working.
      this.flowDots.get(agent.agentId)?.classList.toggle('is-active', status === 'running');
      const failover = agent.failedOver ? ' · Failover' : '';
      row.statusEl.setText(`${STATUS_LABELS[status] ?? status}${failover}`);
      row.fillEl.style.transform = `scaleX(${Math.min(1, Math.max(0, (agent.progress ?? 0) / 100))})`;

      const output = (agent.output ?? '').trim();
      if (output) {
        const tail = output.slice(-PREVIEW_MAX_CHARS).replace(/\s+/g, ' ').trim();
        row.previewEl.setText(tail);
      }
    }

    const synthesis = progress.synthesis;
    if (synthesis) {
      const synthStatus = synthesis.status ?? 'pending';
      this.hubEl.classList.toggle('is-pending', synthStatus === 'pending');
      this.hubEl.classList.toggle('is-running', synthStatus === 'running');
      this.hubEl.classList.toggle('is-done', synthStatus === 'done');
      this.hubEl.classList.toggle('is-error', synthStatus === 'error');
    }
    if (synthesis && (synthesis.output || synthesis.status !== 'pending')) {
      this.synthSectionEl.removeClass('claudian-hidden');
      if (synthesis.output) {
        this.synthOutputEl.setText(synthesis.output);
      }
    }
  }

  /** The board is ephemeral — remove it once the persistent summary lands. */
  remove(): void {
    this.rootEl.remove();
  }

  /** Keeps the board in view while it grows. */
  scrollIntoView(): void {
    this.rootEl.scrollIntoView({ block: 'end' });
  }
}
