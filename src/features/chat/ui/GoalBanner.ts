import { setIcon } from 'obsidian';

/**
 * Persistent banner that shows the chat's active "goal" — the standing
 * objective the agent should keep working toward (set via `/goal <text>`).
 * Mirrors the CLI's goal indicator so you can see at a glance that a goal is
 * running and on which provider (Claude / Kimi / Codex / …).
 *
 * Pure view: the goal text itself is owned by the tab; this component only
 * renders it and reports clear clicks back via {@link GoalBannerOptions.onClear}.
 */
export interface GoalBannerOptions {
  /** Stable host element (kept at the top of the tab content) to render into. */
  mountEl: HTMLElement;
  /** Invoked when the user clears the goal via the × button. */
  onClear: () => void;
  /** Invoked with the current goal when the user clicks the banner body to edit it. */
  onEdit?: (currentGoal: string) => void;
}

export class GoalBanner {
  private readonly rootEl: HTMLElement;
  private readonly providerEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private currentGoal = '';
  private active = false;

  constructor(options: GoalBannerOptions) {
    this.rootEl = options.mountEl.createDiv({ cls: 'claudian-goal-banner claudian-hidden' });

    const iconEl = this.rootEl.createSpan({ cls: 'claudian-goal-banner-icon' });
    setIcon(iconEl, 'target');

    const bodyEl = this.rootEl.createDiv({ cls: 'claudian-goal-banner-body' });
    const headEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-head' });
    headEl.createSpan({ cls: 'claudian-goal-banner-label', text: 'Goal aktiv' });
    this.providerEl = headEl.createSpan({ cls: 'claudian-goal-banner-provider' });
    this.textEl = bodyEl.createDiv({ cls: 'claudian-goal-banner-text' });

    // Click the body to edit the goal (prefills the input with /goal <current>).
    if (options.onEdit) {
      bodyEl.addClass('claudian-goal-banner-editable');
      bodyEl.setAttribute('role', 'button');
      bodyEl.setAttribute('tabindex', '0');
      bodyEl.setAttribute('aria-label', 'Goal bearbeiten');
      bodyEl.addEventListener('click', () => options.onEdit?.(this.currentGoal));
    }

    const clearEl = this.rootEl.createEl('button', { cls: 'claudian-goal-banner-clear' });
    clearEl.setAttribute('type', 'button');
    clearEl.setAttribute('aria-label', 'Goal löschen');
    setIcon(clearEl, 'x');
    clearEl.addEventListener('click', (e) => {
      e.stopPropagation();
      options.onClear();
    });
  }

  /** Shows the banner with the given goal text and provider label. */
  setGoal(goalText: string, providerLabel: string): void {
    this.currentGoal = goalText;
    this.textEl.setText(goalText);
    this.providerEl.setText(providerLabel);
    this.providerEl.toggleClass('claudian-hidden', providerLabel.length === 0);
    this.rootEl.removeClass('claudian-hidden');
    this.active = true;
  }

  /** Hides the banner and forgets the rendered goal. */
  clear(): void {
    this.rootEl.addClass('claudian-hidden');
    this.textEl.setText('');
    this.providerEl.setText('');
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
