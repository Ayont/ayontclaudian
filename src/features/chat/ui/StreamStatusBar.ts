import { setIcon } from 'obsidian';

/**
 * Live "the assistant is working" status bar. Shown above the composer while a
 * turn is streaming, for every provider. Displays a pulsing dot, a label, and a
 * running elapsed timer so there is always visible feedback that something is
 * happening — even before the first token arrives.
 */

const TICK_MS = 1000;
const SECONDS_PER_MINUTE = 60;
export const MAX_ACTIVITY_HISTORY = 8;

export interface StreamActivity {
  primary: string;
  meta: string;
  at: number;
}

/** Formats an elapsed duration (ms) as `Xs` under a minute, else `M:SS`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Appends a distinct activity while keeping the live inspector intentionally
 * small. Provider streams can emit many identical text/thinking chunks; those
 * must not cause DOM churn or bury the actual tool and workflow transitions.
 */
export function appendActivity(
  activities: readonly StreamActivity[],
  activity: StreamActivity,
  limit = MAX_ACTIVITY_HISTORY,
): StreamActivity[] {
  const previous = activities.at(-1);
  if (previous?.primary === activity.primary && previous.meta === activity.meta) {
    return [...activities];
  }
  return [...activities, activity].slice(-Math.max(1, limit));
}

function formatActivityOffset(startedAt: number, at: number): string {
  return `+${formatElapsed(Math.max(0, at - startedAt))}`;
}

export class StreamStatusBar {
  private readonly el: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly phraseEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly detailPrimaryEl: HTMLElement;
  private readonly detailMetaEl: HTMLElement;
  private readonly activityHistoryEl: HTMLElement;
  private intervalId: number | null = null;
  private startedAt = 0;
  private readonly now: () => number;
  private currentLabel = 'Generiert…';
  private currentPhrase = 'working';
  private currentActivity = 'Waiting for provider events';
  private currentMeta = 'No tool activity yet';
  private activities: StreamActivity[] = [];
  private isOpen = false;

  constructor(parentEl: HTMLElement, now: () => number = () => Date.now()) {
    this.now = now;
    this.el = parentEl.createDiv({ cls: 'claudian-stream-status claudian-hidden' });
    // Sit at the top of the input area (just below the messages), above the
    // nav row and composer, so the "working" status is clearly visible.
    parentEl.prepend(this.el);

    this.toggleEl = this.el.createEl('button', { cls: 'claudian-stream-status-toggle' });
    this.toggleEl.setAttribute('type', 'button');
    this.toggleEl.setAttribute('aria-expanded', 'false');
    this.toggleEl.setAttribute('aria-label', 'Show live activity details');

    this.toggleEl.createSpan({ cls: 'claudian-stream-status-dot' });
    const textEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-text' });
    this.labelEl = textEl.createSpan({ cls: 'claudian-stream-status-label' });
    this.labelEl.setText(this.currentLabel);
    this.phraseEl = textEl.createSpan({ cls: 'claudian-stream-status-phrase' });
    this.phraseEl.setText(this.currentPhrase);
    this.timerEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-timer' });
    const chevronEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-chevron' });
    setIcon(chevronEl, 'chevron-up');

    this.detailEl = this.el.createDiv({ cls: 'claudian-stream-status-detail' });
    this.detailPrimaryEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-detail-primary' });
    this.detailMetaEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-detail-meta' });
    this.activityHistoryEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-history' });
    this.renderDetail();

    this.toggleEl.addEventListener('click', () => this.toggleOpen());
  }

  /** Shows the bar with a fresh timer, or hides it, based on streaming state. */
  setStreaming(streaming: boolean): void {
    if (streaming) {
      this.start();
    } else {
      this.stop();
    }
  }

  /** Updates the visible label (e.g. the current tool the provider is running). */
  setLabel(text: string): void {
    this.currentLabel = text;
    this.labelEl.setText(text);
    this.renderDetail();
  }

  /** Updates the moving flavor phrase shown next to the provider/model label. */
  setPhrase(text: string): void {
    this.currentPhrase = text;
    this.phraseEl.setText(text);
    this.renderDetail();
  }

  /** Updates the expandable live detail row with the latest provider activity. */
  setActivity(primary: string, meta = ''): void {
    const nextPrimary = primary || 'Working';
    const nextMeta = meta || this.currentLabel;
    const wasCurrentActivity = this.currentActivity === nextPrimary && this.currentMeta === nextMeta;
    this.currentActivity = nextPrimary;
    this.currentMeta = nextMeta;
    if (!wasCurrentActivity) {
      this.activities = appendActivity(this.activities, {
        primary: nextPrimary,
        meta: nextMeta,
        at: this.now(),
      });
    }
    this.renderDetail();
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen;
    this.el.toggleClass('is-open', this.isOpen);
    this.toggleEl.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
  }

  private start(): void {
    this.startedAt = this.now();
    this.activities = [];
    this.currentActivity = 'Starting provider turn';
    this.currentMeta = this.currentLabel;
    this.activities = appendActivity(this.activities, {
      primary: this.currentActivity,
      meta: this.currentMeta,
      at: this.startedAt,
    });
    this.renderDetail();
    this.renderTimer();
    this.el.removeClass('claudian-hidden');
    this.clearTimer();
    this.intervalId = window.setInterval(() => this.renderTimer(), TICK_MS);
  }

  private stop(): void {
    this.clearTimer();
    this.el.addClass('claudian-hidden');
    this.el.removeClass('is-open');
    this.isOpen = false;
    this.toggleEl.setAttribute('aria-expanded', 'false');
    this.setLabel('Generiert…');
    this.setPhrase('working');
    this.currentActivity = 'Waiting for provider events';
    this.currentMeta = 'No tool activity yet';
    this.activities = [];
    this.renderDetail();
  }

  private renderTimer(): void {
    this.timerEl.setText(formatElapsed(this.now() - this.startedAt));
  }

  private renderDetail(): void {
    this.detailPrimaryEl.setText(this.currentActivity);
    this.detailMetaEl.setText(`${this.currentLabel} · ${this.currentPhrase}${this.currentMeta ? ` · ${this.currentMeta}` : ''}`);
    this.activityHistoryEl.empty();
    if (this.activities.length === 0) return;

    const heading = this.activityHistoryEl.createDiv({ cls: 'claudian-stream-status-history-heading' });
    heading.setText(`Live activity · ${this.activities.length}`);
    const list = this.activityHistoryEl.createEl('ol', { cls: 'claudian-stream-status-history-list' });
    for (const activity of this.activities) {
      const row = list.createEl('li', { cls: 'claudian-stream-status-history-item' });
      row.createSpan({
        cls: 'claudian-stream-status-history-time',
        text: formatActivityOffset(this.startedAt, activity.at),
      });
      const content = row.createSpan({ cls: 'claudian-stream-status-history-content' });
      content.createSpan({ cls: 'claudian-stream-status-history-primary', text: activity.primary });
      if (activity.meta) {
        content.createSpan({ cls: 'claudian-stream-status-history-meta', text: activity.meta });
      }
    }
  }

  private clearTimer(): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Stops the timer and removes the element; safe to call multiple times. */
  destroy(): void {
    this.clearTimer();
    this.el.remove();
  }
}
