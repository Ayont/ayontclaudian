import { setIcon } from 'obsidian';

import { getToolIcon } from '../../../core/tools/toolIcons';
import type { SubagentInfo } from '../../../core/types';
import type { SubagentManager } from '../services/SubagentManager';
import type { SubagentStopScope } from '../subagents/SubagentActionController';
import { STOP_ARM_MS, stopConfirmLabel } from '../subagents/SubagentActionController';
import {
  describeSubagentActivity,
  formatSubagentDuration,
  formatSubagentTokens,
  isLiveSubagentPhase,
  resolveSubagentPhase,
  SUBAGENT_PHASE_LABELS,
  type SubagentPhase,
  subagentTitle,
} from '../subagents/subagentPresentation';

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
  /** Opens the agent in the inspector tab; without it a row jumps to its card. */
  onInspect?: (subagentId: string) => void;
  onStop?: (subagentId: string) => void;
  getStopScope?: (subagentId: string) => SubagentStopScope;
}

interface StatusVisual {
  icon: string;
  cls: string;
  label: string;
}

const FLASH_CLASS = 'claudian-swarm-flash';
const FLASH_MS = 1600;

const PHASE_VISUALS: Record<SubagentPhase, { icon: string; cls: string }> = {
  starting: { icon: 'clock', cls: 'pending' },
  running: { icon: 'loader-2', cls: 'running' },
  stopping: { icon: 'loader-2', cls: 'stopping' },
  completed: { icon: 'check', cls: 'completed' },
  failed: { icon: 'x', cls: 'error' },
  cancelled: { icon: 'square', cls: 'cancelled' },
  orphaned: { icon: 'alert-circle', cls: 'orphaned' },
};

function resolveStatusVisual(info: SubagentInfo): StatusVisual {
  const phase = resolveSubagentPhase(info);
  return { ...PHASE_VISUALS[phase], label: SUBAGENT_PHASE_LABELS[phase] };
}

function isRunning(info: SubagentInfo): boolean {
  return isLiveSubagentPhase(resolveSubagentPhase(info));
}

function formatDuration(ms: number): string {
  return formatSubagentDuration(ms);
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
  private readonly armedStops = new Set<string>();
  private readonly armTimers = new Map<string, number>();
  private renderScheduled = false;
  private disposed = false;
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
    this.toggleEl.createSpan({ cls: 'claudian-swarm-toggle-label', text: 'Live-Arbeit' });
    this.countEl = this.toggleEl.createSpan({ cls: 'claudian-swarm-count' });
    this.autoContinueEl = this.toggleEl.createSpan({
      cls: 'claudian-swarm-auto-continue claudian-hidden',
      text: 'Fährt automatisch fort',
    });
    const chevronEl = this.toggleEl.createSpan({ cls: 'claudian-swarm-chevron' });
    setIcon(chevronEl, 'chevron-down');
    this.toggleEl.addEventListener('click', () => this.toggleOpen());

    this.listEl = this.rootEl.createDiv({ cls: 'claudian-swarm-list' });

    this.unsubscribe = options.manager.onSwarmChange(() => this.scheduleRender());
    this.render();
  }

  /** Opens the overview and moves focus to it (hand-over from the library). */
  public reveal(): void {
    this.isOpen = true;
    this.applyOpenState();
    this.toggleEl.focus();
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
    if (this.renderScheduled || this.disposed) return;
    this.renderScheduled = true;
    window.requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  private render(): void {
    // A render can be scheduled one tick before destroy(); bail out so the
    // deferred rAF doesn't re-arm the ticker (setInterval) on a detached panel.
    if (this.disposed) return;

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
      `${agents.length} ${agents.length === 1 ? 'Subagent' : 'Subagents'}`
        + (runningCount > 0 ? `, ${runningCount} aktiv` : ''),
    );
    this.applyOpenState();

    // Rows are rebuilt on every change; keep keyboard focus on the same control
    // so an armed Stop can still be confirmed with Enter.
    const focus = this.captureFocus();
    this.listEl.empty();
    this.liveDurations.clear();
    for (const info of agents) {
      this.renderAgentRow(info);
    }
    this.restoreFocus(focus);
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
    const row = this.listEl.createDiv({ cls: `claudian-swarm-agent status-${status.cls}` });
    row.dataset.kind = info.kind ?? 'agent';
    row.dataset.agentId = info.id;
    if (info.providerId) row.dataset.provider = info.providerId;

    // The row's main area is one button; its actions are siblings, never nested.
    const open = row.createEl('button', { cls: 'claudian-swarm-agent-open', attr: { type: 'button' } });
    if (info.kind === 'workflow') {
      open.setAttribute('aria-expanded', this.expandedWorkflowIds.has(info.id) ? 'true' : 'false');
    }

    const statusEl = open.createSpan({ cls: 'claudian-swarm-agent-status' });
    statusEl.setAttribute('aria-label', status.label);
    setIcon(statusEl, status.icon);

    const main = open.createDiv({ cls: 'claudian-swarm-agent-main' });
    const nameRow = main.createDiv({ cls: 'claudian-swarm-agent-name-row' });
    nameRow.createSpan({ cls: 'claudian-swarm-agent-name', text: subagentTitle(info) });
    if (info.kind === 'workflow') {
      nameRow.createSpan({ cls: 'claudian-swarm-agent-mode mode-workflow', text: 'Workflow' });
    } else if (info.mode === 'async') {
      nameRow.createSpan({ cls: 'claudian-swarm-agent-mode mode-async', text: 'Hintergrund' });
    }
    if (info.agentType) {
      nameRow.createSpan({ cls: 'claudian-swarm-agent-type', text: info.agentType });
    }

    const activityEl = main.createDiv({ cls: 'claudian-swarm-agent-activity' });
    const activity = describeSubagentActivity(info);
    if (activity) {
      const iconEl = activityEl.createSpan({ cls: 'claudian-swarm-agent-activity-icon' });
      setIcon(iconEl, activity.toolName ? getToolIcon(activity.toolName) : 'activity');
      activityEl.createSpan({ cls: 'claudian-swarm-agent-activity-text', text: activity.text });
    } else {
      activityEl.createSpan({ cls: 'claudian-swarm-agent-activity-text is-muted', text: status.label });
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

    const meta = open.createDiv({ cls: 'claudian-swarm-agent-meta' });
    const toolCount = Math.max(info.toolCalls.length, info.toolUses ?? 0);
    if (toolCount > 0) {
      meta.createSpan({
        cls: 'claudian-swarm-agent-tools',
        text: `${toolCount} ${toolCount === 1 ? 'Werkzeug' : 'Werkzeuge'}`,
      });
    }
    if ((info.totalTokens ?? 0) > 0) {
      meta.createSpan({ cls: 'claudian-swarm-agent-tokens', text: formatSubagentTokens(info.totalTokens ?? 0) });
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

    open.setAttribute('aria-label', `${subagentTitle(info)} – ${status.label}${
      info.kind === 'workflow' ? '' : this.options.onInspect ? ' – im Inspektor öffnen' : ' – im Chat zeigen'
    }`);
    open.addEventListener('click', () => {
      if (info.kind === 'workflow') {
        if (this.expandedWorkflowIds.has(info.id)) this.expandedWorkflowIds.delete(info.id);
        else this.expandedWorkflowIds.add(info.id);
        this.render();
        return;
      }
      if (this.options.onInspect) this.options.onInspect(info.id);
      else this.focusSubagent(info.id);
    });

    this.renderRowActions(row, info);
  }

  private renderRowActions(row: HTMLElement, info: SubagentInfo): void {
    const actions = row.createDiv({ cls: 'claudian-swarm-agent-actions' });
    if (info.kind !== 'workflow') {
      const locate = actions.createEl('button', {
        cls: 'claudian-swarm-agent-action claudian-swarm-agent-locate',
        attr: { type: 'button', 'aria-label': 'Im Chat zeigen', title: 'Im Chat zeigen' },
      });
      setIcon(locate, 'locate-fixed');
      locate.addEventListener('click', () => this.focusSubagent(info.id));
    }

    const scope = this.options.getStopScope?.(info.id) ?? 'none';
    if (!this.options.onStop || !isRunning(info) || scope === 'none' || info.cancelState === 'requested') return;
    const stop = actions.createEl('button', {
      cls: 'claudian-swarm-agent-action claudian-swarm-agent-stop',
      attr: { type: 'button', 'aria-label': 'Subagent stoppen', title: 'Subagent stoppen' },
    });
    setIcon(stop.createSpan({ cls: 'claudian-swarm-agent-stop-icon' }), 'square');
    const label = stop.createSpan({ cls: 'claudian-swarm-agent-stop-label' });
    stop.addEventListener('click', () => {
      // Same two-step stop as the card: arm, then confirm.
      if (!this.armedStops.has(info.id)) {
        this.armedStops.add(info.id);
        stop.addClass('is-armed');
        label.setText(stopConfirmLabel(scope));
        stop.setAttribute('aria-label', `${stopConfirmLabel(scope)} Zum Bestätigen erneut klicken.`);
        const timer = window.setTimeout(() => {
          this.armedStops.delete(info.id);
          this.armTimers.delete(info.id);
          this.scheduleRender();
        }, STOP_ARM_MS);
        this.armTimers.set(info.id, timer);
        return;
      }
      this.disarmStop(info.id);
      this.options.onStop?.(info.id);
    });
    if (this.armedStops.has(info.id)) {
      stop.addClass('is-armed');
      label.setText(stopConfirmLabel(scope));
    }
  }

  private disarmStop(id: string): void {
    const timer = this.armTimers.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    this.armTimers.delete(id);
    this.armedStops.delete(id);
  }

  private captureFocus(): { id: string; control: string } | null {
    const active = this.listEl.ownerDocument?.activeElement as HTMLElement | null | undefined;
    if (!active || !this.listEl.contains(active)) return null;
    const row = active.closest?.('.claudian-swarm-agent') as HTMLElement | null;
    const id = row?.dataset.agentId;
    const control = ['claudian-swarm-agent-stop', 'claudian-swarm-agent-locate', 'claudian-swarm-agent-open']
      .find(cls => active.classList.contains(cls));
    return id && control ? { id, control } : null;
  }

  private restoreFocus(focus: { id: string; control: string } | null): void {
    if (!focus) return;
    const row = Array.from(this.listEl.children).find(
      child => (child as HTMLElement).dataset?.agentId === focus.id,
    ) as HTMLElement | undefined;
    const target = row?.querySelector(`.${focus.control}`) as HTMLElement | null
      ?? row?.querySelector('.claudian-swarm-agent-open') as HTMLElement | null;
    target?.focus();
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
    this.disposed = true;
    this.unsubscribe();
    if (this.tickId !== null) {
      window.clearInterval(this.tickId);
      this.tickId = null;
    }
    this.liveDurations.clear();
    this.expandedWorkflowIds.clear();
    for (const timer of this.armTimers.values()) window.clearTimeout(timer);
    this.armTimers.clear();
    for (const timer of this.flashTimers) {
      window.clearTimeout(timer);
    }
    this.flashTimers.clear();
    this.rootEl.remove();
  }
}
