import { setIcon } from 'obsidian';

import { describeNativeGoal } from '../../../core/conversation/nativeGoal';
import type { NativeGoalCapability } from '../../../core/providers/types';
import type { NativeGoalState } from '../../../core/types';

/**
 * Persistent banner that shows the chat's active "goal" — the standing
 * objective the agent should keep working toward (set via `/goal <text>`).
 * Mirrors the CLI's goal indicator so you can see at a glance that a goal is
 * running and on which provider (Claude / Kimi / Codex / …).
 *
 * Pure view: the goal text and the paused flag are owned by the tab / plugin;
 * this component renders them and reports intent back through its callbacks.
 * Every `/goal` sub-command reachable from the composer has a button here, so
 * the banner is a complete control surface rather than a label with an × on it.
 */
export interface GoalBannerOptions {
  /** Stable host element (kept at the top of the tab content) to render into. */
  mountEl: HTMLElement;
  /** Clears the goal entirely (`/goal clear`). */
  onClear: () => void;
  /** Marks the goal reached and clears it (`/goal done`). */
  onDone?: () => void;
  /** Invoked with the current goal when the user clicks the banner body to edit it. */
  onEdit?: (currentGoal: string) => void;
  /** Suspends / resumes the harness loop (`/goal pause` · `/goal resume`). */
  onTogglePause?: (paused: boolean) => void;
  /** Pauses (true) or resumes a goal the provider runs itself. */
  onNativeTogglePause?: (pause: boolean) => void;
}

const NATIVE_STATUS_ICON: Record<NativeGoalState['status'], string> = {
  active: 'target',
  paused: 'pause',
  blocked: 'circle-alert',
  usage_limited: 'gauge',
  budget_limited: 'gauge',
  complete: 'circle-check',
};

const GOAL_LABEL_ACTIVE = 'Ziel aktiv';
const GOAL_LABEL_PAUSED = 'Ziel pausiert';

export class GoalBanner {
  private readonly rootEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly providerEl: HTMLElement;
  private readonly loopEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly pauseEl: HTMLButtonElement | null = null;
  /** Set while the provider's own goal system runs the goal. */
  private native: { state: NativeGoalState; capability: NativeGoalCapability | null } | null = null;
  private readonly doneEl: HTMLButtonElement | null = null;
  private currentGoal = '';
  private active = false;
  private paused = false;

  constructor(options: GoalBannerOptions) {
    this.rootEl = options.mountEl.createDiv({ cls: 'claudian-goal-banner claudian-hidden' });

    this.iconEl = this.rootEl.createSpan({ cls: 'claudian-goal-banner-icon' });
    setIcon(this.iconEl, 'target');

    const bodyEl = this.rootEl.createDiv({ cls: 'claudian-goal-banner-body' });
    const headEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-head' });
    this.labelEl = headEl.createSpan({ cls: 'claudian-goal-banner-label', text: GOAL_LABEL_ACTIVE });
    this.providerEl = headEl.createSpan({ cls: 'claudian-goal-banner-provider' });
    this.loopEl = headEl.createSpan({ cls: 'claudian-goal-banner-loop claudian-hidden' });
    this.textEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-text' });
    this.detailEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-detail claudian-hidden' });

    // Click the body to edit the goal (prefills the input with /goal <current>).
    if (options.onEdit) {
      bodyEl.addClass('claudian-goal-banner-editable');
      bodyEl.setAttribute('role', 'button');
      bodyEl.setAttribute('tabindex', '0');
      bodyEl.setAttribute('aria-label', 'Ziel bearbeiten');
      bodyEl.addEventListener('click', () => options.onEdit?.(this.currentGoal));
      bodyEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          options.onEdit?.(this.currentGoal);
        }
      });
    }

    const actionsEl = this.rootEl.createDiv({ cls: 'claudian-goal-banner-actions' });

    if (options.onTogglePause || options.onNativeTogglePause) {
      this.pauseEl = this.createAction(actionsEl, 'pause', 'Zielschleife pausieren');
      this.pauseEl.addEventListener('click', (event) => {
        event.stopPropagation();
        if (this.native) {
          options.onNativeTogglePause?.(this.native.state.status === 'active');
          return;
        }
        options.onTogglePause?.(!this.paused);
      });
    }

    if (options.onDone) {
      this.doneEl = this.createAction(actionsEl, 'check', 'Ziel als erreicht markieren');
      this.doneEl.addClass('claudian-goal-banner-action--done');
      this.doneEl.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onDone?.();
      });
    }

    const clearEl = this.createAction(actionsEl, 'x', 'Ziel löschen');
    clearEl.addClass('claudian-goal-banner-clear');
    clearEl.addEventListener('click', (event) => {
      event.stopPropagation();
      options.onClear();
    });
  }

  private createAction(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
    const button = parent.createEl('button', { cls: 'claudian-goal-banner-action' });
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', label);
    button.setAttribute('data-tooltip', label);
    setIcon(button, icon);
    return button;
  }

  /**
   * Shows the banner with the given goal text and provider label.
   *
   * `loopLabel` marks providers that do not just carry the goal along but
   * actually work it to completion across turns (Cline's goal loop) — without it
   * the two very different behaviors look identical in the UI.
   */
  setGoal(goalText: string, providerLabel: string, loopLabel?: string): void {
    this.currentGoal = goalText;
    this.textEl.setText(goalText);
    this.providerEl.setText(providerLabel);
    this.providerEl.toggleClass('claudian-hidden', providerLabel.length === 0);
    this.loopEl.setText(loopLabel ?? '');
    this.loopEl.toggleClass('claudian-hidden', !loopLabel);
    this.rootEl.removeClass('claudian-hidden');
    this.active = true;
  }

  /**
   * Reflects the harness loop's paused state. Kept separate from
   * {@link setGoal} because pausing is a global switch that can flip without the
   * goal itself changing.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.rootEl.toggleClass('is-paused', paused);
    this.labelEl.setText(paused ? GOAL_LABEL_PAUSED : GOAL_LABEL_ACTIVE);
    if (this.pauseEl) {
      const label = paused ? 'Zielschleife fortsetzen' : 'Zielschleife pausieren';
      this.pauseEl.setAttribute('aria-label', label);
      this.pauseEl.setAttribute('data-tooltip', label);
      this.pauseEl.toggleClass('is-paused', paused);
      setIcon(this.pauseEl, paused ? 'play' : 'pause');
    }
  }

  /**
   * Switches the banner between Claudian's loop (null) and a goal the
   * provider's own goal system runs, showing its status, round and budget.
   */
  setNative(state: NativeGoalState | null, capability: NativeGoalCapability | null): void {
    this.native = state ? { state, capability } : null;
    this.rootEl.toggleClass('is-native', Boolean(state));
    if (!state) {
      this.rootEl.removeAttribute('data-tone');
      this.rootEl.removeAttribute('data-status');
      this.detailEl.setText('');
      this.detailEl.addClass('claudian-hidden');
      this.doneEl?.removeClass('claudian-hidden');
      this.pauseEl?.removeClass('claudian-hidden');
      setIcon(this.iconEl, 'target');
      return;
    }

    const description = describeNativeGoal(state);
    this.rootEl.setAttribute('data-tone', description.tone);
    this.rootEl.setAttribute('data-status', state.status);
    this.rootEl.toggleClass('is-paused', description.tone === 'muted');
    this.labelEl.setText(description.label);
    this.loopEl.setText('nativ');
    this.loopEl.setAttribute('title', 'Läuft im eigenen Ziel-System des Anbieters');
    this.loopEl.removeClass('claudian-hidden');
    this.detailEl.setText(description.detail);
    this.detailEl.toggleClass('claudian-hidden', !description.detail);
    setIcon(this.iconEl, NATIVE_STATUS_ICON[state.status] ?? 'target');

    // The provider decides when its goal is done; only a pausable one gets pause.
    this.doneEl?.addClass('claudian-hidden');
    const canToggle = Boolean(capability?.canPause) && (state.status === 'active' || state.status === 'paused');
    if (this.pauseEl) {
      this.pauseEl.toggleClass('claudian-hidden', !canToggle);
      const paused = state.status === 'paused';
      const label = paused ? 'Ziel fortsetzen' : 'Ziel pausieren';
      this.pauseEl.setAttribute('aria-label', label);
      this.pauseEl.setAttribute('data-tooltip', label);
      this.pauseEl.toggleClass('is-paused', paused);
      setIcon(this.pauseEl, paused ? 'play' : 'pause');
    }
  }

  /** Hides the banner and forgets the rendered goal. */
  clear(): void {
    this.setNative(null, null);
    this.rootEl.addClass('claudian-hidden');
    this.textEl.setText('');
    this.providerEl.setText('');
    this.loopEl.setText('');
    this.loopEl.addClass('claudian-hidden');
    this.currentGoal = '';
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.rootEl.remove();
  }
}
