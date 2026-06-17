import { setIcon } from 'obsidian';

/**
 * Live "the assistant is working" status bar. Shown above the composer while a
 * turn is streaming, for every provider. Displays a pulsing dot, a label, and a
 * running elapsed timer so there is always visible feedback that something is
 * happening — even before the first token arrives.
 */

const TICK_MS = 1000;
const SECONDS_PER_MINUTE = 60;

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

export class StreamStatusBar {
  private readonly el: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly labelEl: HTMLElement;
  private readonly phraseEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly detailPrimaryEl: HTMLElement;
  private readonly detailMetaEl: HTMLElement;
  private intervalId: number | null = null;
  private startedAt = 0;
  private readonly now: () => number;
  private currentLabel = 'Generiert…';
  private currentPhrase = 'working';
  private currentActivity = 'Waiting for provider events';
  private currentMeta = 'No tool activity yet';
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
    this.currentActivity = primary || 'Working';
    this.currentMeta = meta || this.currentLabel;
    this.renderDetail();
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen;
    this.el.toggleClass('is-open', this.isOpen);
    this.toggleEl.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
  }

  private start(): void {
    this.startedAt = this.now();
    this.currentActivity = 'Starting provider turn';
    this.currentMeta = this.currentLabel;
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
    this.renderDetail();
  }

  private renderTimer(): void {
    this.timerEl.setText(formatElapsed(this.now() - this.startedAt));
  }

  private renderDetail(): void {
    this.detailPrimaryEl.setText(this.currentActivity);
    this.detailMetaEl.setText(`${this.currentLabel} · ${this.currentPhrase}${this.currentMeta ? ` · ${this.currentMeta}` : ''}`);
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
