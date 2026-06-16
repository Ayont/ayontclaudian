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
  private readonly labelEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private intervalId: number | null = null;
  private startedAt = 0;
  private readonly now: () => number;

  constructor(parentEl: HTMLElement, now: () => number = () => Date.now()) {
    this.now = now;
    this.el = parentEl.createDiv({ cls: 'claudian-stream-status claudian-hidden' });
    // Sit at the top of the input area (just below the messages), above the
    // nav row and composer, so the "working" status is clearly visible.
    parentEl.prepend(this.el);
    this.el.createSpan({ cls: 'claudian-stream-status-dot' });
    this.labelEl = this.el.createSpan({ cls: 'claudian-stream-status-label' });
    this.labelEl.setText('Generiert…');
    this.timerEl = this.el.createSpan({ cls: 'claudian-stream-status-timer' });
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
    this.labelEl.setText(text);
  }

  private start(): void {
    this.startedAt = this.now();
    this.renderTimer();
    this.el.removeClass('claudian-hidden');
    this.clearTimer();
    this.intervalId = window.setInterval(() => this.renderTimer(), TICK_MS);
  }

  private stop(): void {
    this.clearTimer();
    this.el.addClass('claudian-hidden');
    this.labelEl.setText('Generiert…');
  }

  private renderTimer(): void {
    this.timerEl.setText(formatElapsed(this.now() - this.startedAt));
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
