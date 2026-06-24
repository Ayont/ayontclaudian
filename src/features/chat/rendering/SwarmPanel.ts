import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import type { SubagentInfo } from '../../../core/types';
import type { SubagentManager } from '../services/SubagentManager';
import { getToolLabel } from './ToolCallRenderer';

/**
 * Floating overview of every subagent in the current conversation (a "swarm
 * view"). It lists each agent (sync + async, any provider that emits subagents),
 * its live status, what it is currently doing / where it is coding (its latest
 * tool call), and lets the user click an entry to jump to that agent's inline
 * block in the transcript.
 *
 * Data source: SubagentManager.getAllSubagents(); refreshed via onSwarmChange.
 * Pure view — holds no subagent state of its own.
 */
export interface SwarmPanelOptions {
  manager: SubagentManager;
  /** Element the panel is appended to (positioned relative to it). */
  mountEl: HTMLElement;
  /** Resolves the live transcript container used to locate inline blocks. */
  getMessagesEl: () => HTMLElement;
}

interface StatusVisual {
  icon: string;
  cls: string;
  label: string;
}

const FLASH_CLASS = 'claudian-swarm-flash';
const FLASH_MS = 1600;

function resolveStatusVisual(info: SubagentInfo): StatusVisual {
  if (info.asyncStatus === 'orphaned') {
    return { icon: 'alert-circle', cls: 'orphaned', label: 'Orphaned' };
  }
  if (info.status === 'error' || info.asyncStatus === 'error') {
    return { icon: 'x', cls: 'error', label: 'Error' };
  }
  if (info.status === 'completed' || info.asyncStatus === 'completed') {
    return { icon: 'check', cls: 'completed', label: 'Done' };
  }
  if (info.asyncStatus === 'pending') {
    return { icon: 'clock', cls: 'pending', label: 'Starting' };
  }
  return { icon: 'loader-2', cls: 'running', label: 'Running' };
}

function isRunning(info: SubagentInfo): boolean {
  return info.status === 'running' && info.asyncStatus !== 'orphaned';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/** Latest tool the agent ran — the "what / where it codes" line. */
function describeActivity(info: SubagentInfo): { icon: string; text: string } | null {
  if (info.kind === 'workflow') {
    if (info.lastToolName) {
      return {
        icon: getToolIcon(info.lastToolName),
        text: info.progressSummary || info.description,
      };
    }
    if (info.progressSummary) {
      return { icon: 'activity', text: info.progressSummary };
    }
  }
  const last = info.toolCalls[info.toolCalls.length - 1];
  if (!last) return null;
  return { icon: getToolIcon(last.name), text: getToolLabel(last.name, last.input) };
}

function escapeSelectorId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/["\\]/g, '\\$&');
}

export class SwarmPanel {
  private readonly rootEl: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly countEl: HTMLElement;
  private readonly autoContinueEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly unsubscribe: () => void;

  private isOpen = true;
  private readonly expandedWorkflowIds = new Set<string>();
  private renderScheduled = false;
  private readonly flashTimers = new Set<number>();
  /** Live duration spans for running agents, keyed by agent id, ticked every 1s. */
  private readonly liveDurations = new Map<string, { el: HTMLElement; startedAt: number }>();
  private tickId: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: SwarmPanelOptions, now: () => number = () => Date.now()) {
    this.now = now;
    this.rootEl = options.mountEl.createDiv({ cls: 'claudian-swarm-panel claudian-hidden' });

    this.toggleEl = this.rootEl.createEl('button', { cls: 'claudian-swarm-toggle' });
    this.toggleEl.setAttribute('type', 'button');
    const titleIconEl = this.toggleEl.createSpan({ cls: 'claudian-swarm-toggle-icon' });
    setIcon(titleIconEl, 'workflow');
    this.toggleEl.createSpan({ cls: 'claudian-swarm-toggle-label', text: 'Live work' });
    this.countEl = this.toggleEl.createSpan({ cls: 'claudian-swarm-count' });
    this.autoContinueEl = this.toggleEl.createSpan({
      cls: 'claudian-swarm-auto-continue claudian-hidden',
      text: 'Auto-continue',
    });
    const chevronEl = this.toggleEl.createSpan({ cls: 'claudian-swarm-chevron' });
    setIcon(chevronEl, 'chevron-down');
    this.toggleEl.addEventListener('click', () => this.toggleOpen());

    this.listEl = this.rootEl.createDiv({ cls: 'claudian-swarm-list' });

    this.unsubscribe = options.manager.onSwarmChange(() => this.scheduleRender());
    this.render();
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen;
    this.applyOpenState();
  }

  private applyOpenState(): void {
    this.rootEl.classList.toggle('is-open', this.isOpen);
    this.toggleEl.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
  }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    window.requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private render(): void {
    const agents = this.options.manager.getAllSubagents();

    if (agents.length === 0) {
      this.rootEl.classList.add('claudian-hidden');
      this.listEl.empty();
      return;
    }
    this.rootEl.classList.remove('claudian-hidden');

    const runningCount = agents.filter(isRunning).length;
    const runningWorkflowCount = agents.filter(info => info.kind === 'workflow' && isRunning(info)).length;
    this.countEl.setText(String(agents.length));
    this.rootEl.classList.toggle('has-running', runningCount > 0);
    this.autoContinueEl.classList.toggle('claudian-hidden', runningWorkflowCount === 0);
    this.toggleEl.setAttribute(
      'aria-label',
      `${agents.length} live task${agents.length === 1 ? '' : 's'}`
        + (runningCount > 0 ? `, ${runningCount} running` : ''),
    );
    this.applyOpenState();

    this.listEl.empty();
    this.liveDurations.clear();
    for (const info of agents) {
      this.renderAgentRow(info);
    }
    this.syncTicker();
  }

  /** Runs a 1s ticker only while at least one agent has a live duration. */
  private syncTicker(): void {
    if (this.liveDurations.size > 0) {
      if (this.tickId === null) {
        this.tickId = window.setInterval(() => this.tickDurations(), 1000);
      }
    } else if (this.tickId !== null) {
      window.clearInterval(this.tickId);
      this.tickId = null;
    }
  }

  private tickDurations(): void {
    const now = this.now();
    for (const { el, startedAt } of this.liveDurations.values()) {
      el.setText(formatDuration(now - startedAt));
    }
  }

  private renderAgentRow(info: SubagentInfo): void {
    const status = resolveStatusVisual(info);
    const row = this.listEl.createEl('button', {
      cls: `claudian-swarm-agent status-${status.cls}`,
    });
    row.setAttribute('type', 'button');
    row.dataset.kind = info.kind ?? 'agent';
    if (info.kind === 'workflow') {
      row.setAttribute('aria-expanded', this.expandedWorkflowIds.has(info.id) ? 'true' : 'false');
    }

    const statusEl = row.createSpan({ cls: 'claudian-swarm-agent-status' });
    setIcon(statusEl, status.icon);

    const main = row.createDiv({ cls: 'claudian-swarm-agent-main' });
    const nameRow = main.createDiv({ cls: 'claudian-swarm-agent-name-row' });
    nameRow.createSpan({
      cls: 'claudian-swarm-agent-name',
      text: info.workflowName || info.description || 'Subagent',
    });
    if (info.kind === 'workflow') {
      nameRow.createSpan({
        cls: 'claudian-swarm-agent-mode mode-workflow',
        text: 'Workflow',
      });
    } else if (info.mode) {
      nameRow.createSpan({
        cls: `claudian-swarm-agent-mode mode-${info.mode}`,
        text: info.mode,
      });
    }

    const activityEl = main.createDiv({ cls: 'claudian-swarm-agent-activity' });
    const activity = describeActivity(info);
    if (activity) {
      const iconEl = activityEl.createSpan({ cls: 'claudian-swarm-agent-activity-icon' });
      setIcon(iconEl, activity.icon);
      activityEl.createSpan({
        cls: 'claudian-swarm-agent-activity-text',
        text: activity.text,
      });
    } else {
      activityEl.createSpan({
        cls: 'claudian-swarm-agent-activity-text is-muted',
        text: status.label,
      });
    }

    if (info.kind === 'workflow') {
      const detail = main.createDiv({ cls: 'claudian-swarm-workflow-detail' });
      const detailText = info.result || info.progressSummary || info.prompt || info.description;
      detail.createDiv({ cls: 'claudian-swarm-workflow-detail-text', text: detailText });
      detail.createDiv({
        cls: 'claudian-swarm-workflow-continuation',
        text: isRunning(info)
          ? 'Der Chat fährt nach Abschluss automatisch fort.'
          : info.status === 'completed' ? 'Abgeschlossen, Chat wird fortgesetzt.' : 'Workflow beendet.',
      });
      row.classList.toggle('is-expanded', this.expandedWorkflowIds.has(info.id));
    }

    const meta = row.createDiv({ cls: 'claudian-swarm-agent-meta' });
    const toolCount = info.kind === 'workflow' ? (info.toolUses ?? 0) : info.toolCalls.length;
    if (toolCount > 0) {
      meta.createSpan({
        cls: 'claudian-swarm-agent-tools',
        text: `${toolCount} tool${toolCount === 1 ? '' : 's'}`,
      });
    }

    if (info.kind === 'workflow' && (info.totalTokens ?? 0) > 0) {
      meta.createSpan({
        cls: 'claudian-swarm-agent-tokens',
        text: `${info.totalTokens?.toLocaleString()} tok`,
      });
    }

    if (isRunning(info) && info.startedAt !== undefined) {
      // Live, ticking elapsed time so a long-running agent never looks stuck.
      const durationEl = meta.createSpan({
        cls: 'claudian-swarm-agent-duration is-live',
        text: formatDuration(this.now() - info.startedAt),
      });
      this.liveDurations.set(info.id, { el: durationEl, startedAt: info.startedAt });
    } else {
      const duration = this.formatAgentDuration(info);
      if (duration) {
        meta.createSpan({ cls: 'claudian-swarm-agent-duration', text: duration });
      }
    }

    row.addEventListener('click', () => {
      if (info.kind === 'workflow') {
        if (this.expandedWorkflowIds.has(info.id)) this.expandedWorkflowIds.delete(info.id);
        else this.expandedWorkflowIds.add(info.id);
        this.render();
        return;
      }
      this.focusSubagent(info.id);
    });
  }

  /** Total runtime for finished agents (running agents tick live instead). */
  private formatAgentDuration(info: SubagentInfo): string | null {
    if (info.durationMs !== undefined) return formatDuration(info.durationMs);
    if (info.startedAt === undefined || info.completedAt === undefined) return null;
    return formatDuration(info.completedAt - info.startedAt);
  }

  private focusSubagent(id: string): void {
    const messagesEl = this.options.getMessagesEl();
    const escaped = escapeSelectorId(id);
    const target = messagesEl.querySelector<HTMLElement>(
      `[data-subagent-id="${escaped}"], [data-async-subagent-id="${escaped}"]`,
    );
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add(FLASH_CLASS);
    const timer = window.setTimeout(() => {
      target.classList.remove(FLASH_CLASS);
      this.flashTimers.delete(timer);
    }, FLASH_MS);
    this.flashTimers.add(timer);
  }

  public destroy(): void {
    this.unsubscribe();
    if (this.tickId !== null) {
      window.clearInterval(this.tickId);
      this.tickId = null;
    }
    this.liveDurations.clear();
    this.expandedWorkflowIds.clear();
    for (const timer of this.flashTimers) {
      window.clearTimeout(timer);
    }
    this.flashTimers.clear();
    this.rootEl.remove();
  }
}
