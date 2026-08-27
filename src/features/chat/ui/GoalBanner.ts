import { setIcon } from 'obsidian';

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
}

const GOAL_LABEL_ACTIVE = 'Ziel aktiv';
const GOAL_LABEL_PAUSED = 'Ziel pausiert';

export class GoalBanner {
  private readonly rootEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly providerEl: HTMLElement;
  private readonly loopEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly pauseEl: HTMLButtonElement | null = null;
  private readonly doneEl: HTMLButtonElement | null = null;
  private currentGoal = '';
  private active = false;
  private paused = false;

  constructor(options: GoalBannerOptions) {
    this.rootEl = options.mountEl.createDiv({ cls: 'claudian-goal-banner claudian-hidden' });

    const iconEl = this.rootEl.createSpan({ cls: 'claudian-goal-banner-icon' });
    setIcon(iconEl, 'target');

    const bodyEl = this.rootEl.createDiv({ cls: 'claudian-goal-banner-body' });
    const headEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-head' });
    this.labelEl = headEl.createSpan({ cls: 'claudian-goal-banner-label', text: GOAL_LABEL_ACTIVE });
    this.providerEl = headEl.createSpan({ cls: 'claudian-goal-banner-provider' });
    this.loopEl = headEl.createSpan({ cls: 'claudian-goal-banner-loop claudian-hidden' });
    this.textEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-text' });

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

    if (options.onTogglePause) {
      this.pauseEl = this.createAction(actionsEl, 'pause', 'Zielschleife pausieren');
      this.pauseEl.addEventListener('click', (event) => {
        event.stopPropagation();
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

  /** Hides the banner and forgets the rendered goal. */
  clear(): void {
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
