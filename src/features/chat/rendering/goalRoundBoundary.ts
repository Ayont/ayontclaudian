import { setIcon } from 'obsidian';

/**
 * Divider between two rounds of a provider-driven goal inside one answer: the
 * provider checked its goal, found it not met yet, and kept working.
 */
export function renderGoalRoundBoundary(parent: HTMLElement, round: number, reason?: string): HTMLElement {
  const el = parent.createDiv({ cls: 'claudian-goal-round' });
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-label', reason ? `Ziel, Runde ${round}: ${reason}` : `Ziel, Runde ${round}`);
  const pill = el.createDiv({ cls: 'claudian-goal-round-pill' });
  const icon = pill.createSpan({ cls: 'claudian-goal-round-icon' });
  setIcon(icon, 'target');
  pill.createSpan({ cls: 'claudian-goal-round-label', text: `Runde ${round}` });
  if (reason) {
    const reasonEl = pill.createSpan({ cls: 'claudian-goal-round-reason', text: reason });
    reasonEl.setAttribute('title', reason);
  }
  return el;
}
