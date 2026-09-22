import { setIcon, setTooltip } from 'obsidian';

import {
  cancelScheduledAnimationFrame,
  scheduleAnimationFrame,
  type ScheduledAnimationFrame,
} from '../../../utils/animationFrame';
import {
  AT_BOTTOM_THRESHOLD_PX,
  distanceFromBottom,
  type NavScrollState,
  resolveNavScrollState,
} from './navigationScrollState';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** On the chat root, so CSS can compact chrome outside the transcript (the composer). */
const SCROLLED_AWAY_CLASS = 'claudian-chat--scrolled-away';
const END_LABEL = 'Zum Ende';
const END_ARIA_LABEL = 'Zum Ende scrollen';
const NEW_OUTPUT_LABEL = 'Neue Ausgabe';
const NEW_OUTPUT_ARIA_LABEL = 'Neue Ausgabe – zum Ende scrollen';
/** A smooth scroll that never reports its end must not snap a later, unrelated scroll. */
const END_SNAP_TIMEOUT_MS = 2000;

/**
 * Floating chat navigation: a compact arrow rail (top / previous / next / end)
 * and, once the reader is well away from the end, a centered "Zum Ende" pill
 * that also flags output streaming in below.
 */
export class NavigationSidebar {
  private container: HTMLElement;
  private topBtn: HTMLButtonElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private bottomBtn: HTMLButtonElement;
  private readonly endPill: HTMLButtonElement;
  private readonly endPillLabel: HTMLElement;
  private readonly chatEl: HTMLElement;
  private scrollHandler: () => void = () => {};
  private pendingVisibilityFrame: ScheduledAnimationFrame | null = null;
  private state: NavScrollState | null = null;
  private hasNewOutput = false;
  private outputObserver: MutationObserver | null = null;
  private cancelEndSnap: (() => void) | null = null;

  constructor(
    private parentEl: HTMLElement,
    private messagesEl: HTMLElement
  ) {
    this.chatEl = (this.parentEl.closest?.('.claudian-tab-content') as HTMLElement | null) ?? this.parentEl;
    this.container = this.parentEl.createDiv({ cls: 'claudian-nav-sidebar' });
    this.container.setAttribute('role', 'navigation');
    this.container.setAttribute('aria-label', 'Chat-Navigation');

    this.topBtn = this.createButton('claudian-nav-btn-top', 'chevrons-up', 'Zum Anfang');
    this.prevBtn = this.createButton('claudian-nav-btn-prev', 'chevron-up', 'Vorherige Nachricht');
    this.nextBtn = this.createButton('claudian-nav-btn-next', 'chevron-down', 'Nächste Nachricht');
    this.bottomBtn = this.createButton('claudian-nav-btn-bottom', 'chevrons-down', 'Zum Ende');

    this.endPill = this.parentEl.createEl('button', {
      cls: 'claudian-nav-end-pill',
      attr: { type: 'button', 'aria-label': END_ARIA_LABEL, 'aria-hidden': 'true' },
    }) as HTMLButtonElement;
    this.endPill.inert = true;
    // Above the pill, over the transcript; the pill is hidden while the library is open.
    setTooltip(this.endPill, END_ARIA_LABEL, { placement: 'top' });
    this.endPill.createEl('span', { cls: 'claudian-nav-end-pill-dot', attr: { 'aria-hidden': 'true' } });
    setIcon(
      this.endPill.createEl('span', { cls: 'claudian-nav-end-pill-icon', attr: { 'aria-hidden': 'true' } }),
      'chevron-down',
    );
    this.endPillLabel = this.endPill.createEl('span', { cls: 'claudian-nav-end-pill-label', text: END_LABEL });

    this.setupEventListeners();
    this.applyVisibility();
  }

  private createButton(cls: string, icon: string, label: string): HTMLButtonElement {
    const btn = this.container.createEl('button', {
      cls: `claudian-nav-btn ${cls}`,
      attr: { type: 'button', 'aria-label': label },
    }) as HTMLButtonElement;
    setIcon(btn, icon);
    // Left, i.e. away from the right edge where the library drawer docks. No
    // `title`: Obsidian already shows the aria-label, a second tooltip would stack.
    setTooltip(btn, label, { placement: 'left' });
    return btn;
  }

  private setupEventListeners(): void {
    this.scrollHandler = () => this.updateVisibility();
    this.messagesEl.addEventListener('scroll', this.scrollHandler, { passive: true });

    this.topBtn.addEventListener('click', () => {
      this.messagesEl.scrollTo({ top: 0, behavior: this.scrollBehavior() });
    });
    this.bottomBtn.addEventListener('click', () => this.scrollToEnd());
    this.endPill.addEventListener('click', () => this.scrollToEnd());
    this.prevBtn.addEventListener('click', () => this.scrollToMessage('prev'));
    this.nextBtn.addEventListener('click', () => this.scrollToMessage('next'));
  }

  /** Re-evaluates the scroll state on the next animation frame. */
  updateVisibility(): void {
    if (this.pendingVisibilityFrame !== null) return;
    this.pendingVisibilityFrame = scheduleAnimationFrame(() => {
      this.pendingVisibilityFrame = null;
      this.applyVisibility();
    }, this.messagesEl.ownerDocument.defaultView ?? null);
  }

  private applyVisibility(): void {
    const previous = this.state;
    const next = resolveNavScrollState(this.messagesEl, previous?.away ?? false);
    if (
      previous
      && previous.scrollable === next.scrollable
      && previous.atBottom === next.atBottom
      && previous.away === next.away
    ) return;
    this.state = next;
    this.container.classList.toggle('visible', next.scrollable);
    this.container.setAttribute('aria-hidden', String(!next.scrollable));
    this.container.inert = !next.scrollable;
    this.container.classList.toggle('is-at-bottom', next.atBottom);
    this.container.classList.toggle('is-away', next.away);
    if (!previous || previous.away !== next.away) this.applyAway(next, previous?.away ?? false);
  }

  private applyAway(next: NavScrollState, wasAway: boolean): void {
    const { away } = next;
    this.endPill.classList.toggle('is-visible', away);
    this.endPill.setAttribute('aria-hidden', String(!away));
    this.endPill.inert = !away;
    this.chatEl.classList.toggle(SCROLLED_AWAY_CLASS, away);
    if (away) {
      this.watchForNewOutput();
      return;
    }
    this.stopWatchingOutput();
    this.setNewOutput(false);
    // Un-compacting the chrome shortens the transcript and leaves the end just
    // out of view — which would also keep auto-follow off. Re-pin the end.
    if (wasAway && next.atBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private watchForNewOutput(): void {
    if (this.hasNewOutput || this.outputObserver) return;
    const Observer = this.messagesEl.ownerDocument?.defaultView?.MutationObserver;
    if (typeof Observer !== 'function') return;
    this.outputObserver = new Observer(() => {
      // Only a live turn counts; expanding an older block is not new output.
      if (!this.messagesEl.querySelector('.is-streaming-turn')) return;
      this.stopWatchingOutput();
      this.setNewOutput(true);
    });
    this.outputObserver.observe(this.messagesEl, { childList: true, subtree: true, characterData: true });
  }

  private stopWatchingOutput(): void {
    this.outputObserver?.disconnect();
    this.outputObserver = null;
  }

  private setNewOutput(hasNewOutput: boolean): void {
    if (this.hasNewOutput === hasNewOutput) return;
    this.hasNewOutput = hasNewOutput;
    this.endPill.classList.toggle('has-new-output', hasNewOutput);
    this.endPillLabel.textContent = hasNewOutput ? NEW_OUTPUT_LABEL : END_LABEL;
    this.endPill.setAttribute('aria-label', hasNewOutput ? NEW_OUTPUT_ARIA_LABEL : END_ARIA_LABEL);
  }

  private scrollBehavior(): ScrollBehavior {
    const win = this.messagesEl.ownerDocument?.defaultView;
    const reduced = typeof win?.matchMedia === 'function' && win.matchMedia(REDUCED_MOTION_QUERY).matches;
    return reduced ? 'auto' : 'smooth';
  }

  /** Reaching the end is what re-enables auto-follow (Tab.ts scroll handler). */
  private scrollToEnd(): void {
    const behavior = this.scrollBehavior();
    const alreadyAtEnd = distanceFromBottom(this.messagesEl) <= AT_BOTTOM_THRESHOLD_PX;
    this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior });
    if (behavior === 'smooth' && !alreadyAtEnd) this.snapToEndAfterScroll();
  }

  /**
   * A streaming answer keeps growing while the smooth scroll runs, so it lands
   * short of the end. Snap the rest once it settles, unless the user took over.
   */
  private snapToEndAfterScroll(): void {
    this.cancelEndSnap?.();
    const el = this.messagesEl;
    const win = el.ownerDocument?.defaultView ?? null;
    const onEnd = () => {
      cancel();
      if (distanceFromBottom(el) > AT_BOTTOM_THRESHOLD_PX) el.scrollTop = el.scrollHeight;
    };
    const timer = win?.setTimeout(() => cancel(), END_SNAP_TIMEOUT_MS);
    const cancel = () => {
      el.removeEventListener('scrollend', onEnd);
      el.removeEventListener('wheel', cancel);
      el.removeEventListener('touchstart', cancel);
      el.removeEventListener('pointerdown', cancel);
      if (timer !== undefined) win?.clearTimeout(timer);
      this.cancelEndSnap = null;
    };
    el.addEventListener('scrollend', onEnd);
    el.addEventListener('wheel', cancel, { passive: true });
    el.addEventListener('touchstart', cancel, { passive: true });
    el.addEventListener('pointerdown', cancel);
    this.cancelEndSnap = cancel;
  }

  /**
   * Scrolls to previous or next user message, skipping assistant messages.
   */
  private scrollToMessage(direction: 'prev' | 'next'): void {
    const messages = Array.from(this.messagesEl.querySelectorAll<HTMLElement>('.claudian-message-user'));

    if (messages.length === 0) return;

    const scrollTop = this.messagesEl.scrollTop;
    const threshold = 30;
    const behavior = this.scrollBehavior();

    if (direction === 'prev') {
      // Find the last message strictly above the current scroll position
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].offsetTop < scrollTop - threshold) {
          this.messagesEl.scrollTo({ top: messages[i].offsetTop - 10, behavior });
          return;
        }
      }
      // Already at or above the first message — scroll to top
      this.messagesEl.scrollTo({ top: 0, behavior });
    } else {
      // Find the first message strictly below the current scroll position
      for (let i = 0; i < messages.length; i++) {
        if (messages[i].offsetTop > scrollTop + threshold) {
          this.messagesEl.scrollTo({ top: messages[i].offsetTop - 10, behavior });
          return;
        }
      }
      // Already at or past the last message — scroll to bottom
      this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight, behavior });
    }
  }

  destroy(): void {
    if (this.pendingVisibilityFrame !== null) {
      cancelScheduledAnimationFrame(this.pendingVisibilityFrame);
      this.pendingVisibilityFrame = null;
    }
    this.cancelEndSnap?.();
    this.stopWatchingOutput();
    this.messagesEl.removeEventListener('scroll', this.scrollHandler);
    this.chatEl.classList.remove(SCROLLED_AWAY_CLASS);
    this.container.remove();
    this.endPill.remove();
  }
}
