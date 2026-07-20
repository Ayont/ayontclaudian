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
  private readonly rows = new Map<string, MissionBoardRow>();
  private readonly synthSectionEl: HTMLElement;
  private readonly synthOutputEl: HTMLElement;

  constructor(parentEl: HTMLElement, task: string, agents: SpecialistAgent[]) {
    this.rootEl = parentEl.createDiv({ cls: 'claudian-mission-board' });

    const header = this.rootEl.createDiv({ cls: 'claudian-mission-board-header' });
    const titleEl = header.createDiv({ cls: 'claudian-mission-board-title' });
    setIcon(titleEl.createSpan({ cls: 'claudian-mission-board-icon' }), 'users');
    titleEl.createSpan({ text: 'Team-Mission' });
    header.createDiv({ cls: 'claudian-mission-board-task', text: task });
    const overallTrack = header.createDiv({ cls: 'claudian-mission-board-overall' });
    this.overallFillEl = overallTrack.createDiv({ cls: 'claudian-mission-board-overall-fill' });

    const listEl = this.rootEl.createDiv({ cls: 'claudian-mission-board-list' });
    for (const agent of agents) {
      const rowEl = listEl.createDiv({ cls: 'claudian-mission-board-row is-pending' });

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
    }

    this.synthSectionEl = this.rootEl.createDiv({
      cls: 'claudian-mission-board-synthesis claudian-hidden',
    });
    const synthHead = this.synthSectionEl.createDiv({ cls: 'claudian-mission-board-synth-head' });
    setIcon(synthHead.createSpan({ cls: 'claudian-mission-board-icon' }), 'sparkles');
    synthHead.createSpan({ text: 'Synthese' });
    this.synthOutputEl = this.synthSectionEl.createDiv({ cls: 'claudian-mission-board-synth-output' });
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
      row.rowEl.classList.toggle('is-pending', status === 'pending');
      row.rowEl.classList.toggle('is-running', status === 'running');
      row.rowEl.classList.toggle('is-done', status === 'done');
      row.rowEl.classList.toggle('is-error', status === 'error');
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
