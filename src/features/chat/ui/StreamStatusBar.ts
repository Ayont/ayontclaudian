import { setIcon } from 'obsidian';

import { animateNumber } from '../../../utils/animateNumber';

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

export const STREAM_PHASES = ['Kontext', 'Modell', 'Werkzeuge', 'Antwort', 'Sichern'] as const;

/** Maps provider-neutral activity prose to the visual phase rail. */
export function resolveActivityStage(primary: string): number {
  const value = primary.toLocaleLowerCase('de-DE');
  if (/sicher|speicher|persist|wiederherstellung|fertig|abschl/.test(value)) return 4;
  if (/kontext|vault|memory|rag|erinner/.test(value)) return 0;
  if (/antwort|stream|generier|token|thinking|denk/.test(value)) return 3;
  if (/werkzeug|tool|datei|bash|command|agent|lese|schreib|edit|patch|suche/.test(value)) return 2;
  return 1;
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

/**
 * Formats an activity's offset from stream start. Preflight bursts land within
 * the first second — plain second-granularity rendered a wall of identical
 * `+0s` rows that read as a timing bug. Sub-10s offsets keep one decimal.
 */
export function formatActivityOffset(startedAt: number, at: number): string {
  const ms = Math.max(0, at - startedAt);
  if (ms < 10_000) {
    return `+${(ms / 1000).toFixed(1)}s`;
  }
  return `+${formatElapsed(ms)}`;
}

export interface StreamStatusBarOptions {
  now?: () => number;
  /** Invoked when the user clicks the inline Cancel button. */
  onCancel?: () => void;
}

/** Silence (ms) with no NEW activity before the bar switches to a waiting state. */
const SILENCE_WARN_MS = 10_000;

export class StreamStatusBar {
  private readonly el: HTMLElement;
  private readonly toggleEl: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly progressBarEl: HTMLElement;
  private readonly waitingEl: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly phraseEl: HTMLElement;
  private readonly activityEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly eventCountEl: HTMLElement;
  private readonly eventCountValueEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly detailPrimaryEl: HTMLElement;
  private readonly detailMetaEl: HTMLElement;
  private readonly phaseEls: HTMLElement[] = [];
  private readonly activityHistoryEl: HTMLElement;
  private intervalId: number | null = null;
  private startedAt = 0;
  private lastActivityAt = 0;
  private isWaiting = false;
  private readonly now: () => number;
  private readonly onCancel: (() => void) | null;
  private currentLabel = 'Generiert…';
  private currentPhrase = 'arbeitet';
  private currentActivity = 'Warte auf Provider-Events';
  private currentMeta = 'Noch keine Tool-Aktivität';
  private activities: StreamActivity[] = [];
  private isOpen = false;
  private renderedEventCount = 0;
  private cancelEventCountAnimation: (() => void) | null = null;
  private currentStage = 1;

  constructor(parentEl: HTMLElement, options: StreamStatusBarOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onCancel = options.onCancel ?? null;
    this.el = parentEl.createDiv({ cls: 'claudian-stream-status claudian-hidden' });
    // Sit at the top of the input area (just below the messages), above the
    // nav row and composer, so the "working" status is clearly visible.
    parentEl.prepend(this.el);

    // Header row holds the (button) toggle plus a sibling Cancel button —
    // buttons can't nest, so Cancel lives next to the toggle, not inside it.
    const rowEl = this.el.createDiv({ cls: 'claudian-stream-status-row' });

    this.toggleEl = rowEl.createEl('button', { cls: 'claudian-stream-status-toggle' });
    this.toggleEl.setAttribute('type', 'button');
    this.toggleEl.setAttribute('aria-expanded', 'false');
    this.toggleEl.setAttribute('aria-label', 'Live-Aktivität anzeigen');

    this.toggleEl.createSpan({ cls: 'claudian-stream-status-dot' });
    const textEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-text' });
    const identityEl = textEl.createSpan({ cls: 'claudian-stream-status-identity' });
    this.labelEl = identityEl.createSpan({ cls: 'claudian-stream-status-label' });
    this.labelEl.setText(this.currentLabel);
    this.phraseEl = identityEl.createSpan({ cls: 'claudian-stream-status-phrase' });
    this.phraseEl.setText(this.currentPhrase);
    this.activityEl = textEl.createSpan({ cls: 'claudian-stream-status-activity' });
    this.activityEl.setText(this.currentActivity);
    this.waitingEl = textEl.createSpan({ cls: 'claudian-stream-status-waiting claudian-hidden' });
    this.eventCountEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-event-count' });
    this.eventCountValueEl = this.eventCountEl.createSpan({ text: '0' });
    this.eventCountEl.createSpan({ text: ' Schritte' });
    this.timerEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-timer' });
    const chevronEl = this.toggleEl.createSpan({ cls: 'claudian-stream-status-chevron' });
    setIcon(chevronEl, 'chevron-up');

    // Real, always-clickable Cancel button (replaces the old "klicke Cancel"
    // text that was rendered into the stream and could not be clicked).
    this.cancelButton = rowEl.createEl('button', { cls: 'claudian-stream-status-cancel' });
    this.cancelButton.setAttribute('type', 'button');
    this.cancelButton.setAttribute('aria-label', 'Antwort abbrechen');
    this.cancelButton.setAttribute('title', 'Antwort abbrechen (Esc)');
    setIcon(this.cancelButton.createSpan({ cls: 'claudian-stream-status-cancel-icon' }), 'square');
    this.cancelButton.createSpan({ cls: 'claudian-stream-status-cancel-label', text: 'Stop' });
    this.cancelButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.onCancel?.();
    });

    // Indeterminate progress bar — animated while active, calmer/greyer while
    // waiting on a slow provider.
    const progressTrack = this.el.createDiv({ cls: 'claudian-stream-status-progress' });
    this.progressBarEl = progressTrack.createDiv({ cls: 'claudian-stream-status-progress-bar' });

    this.detailEl = this.el.createDiv({ cls: 'claudian-stream-status-detail' });
    this.detailPrimaryEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-detail-primary' });
    this.detailMetaEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-detail-meta' });
    const phaseRailEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-phases' });
    STREAM_PHASES.forEach((phase, index) => {
      const phaseEl = phaseRailEl.createDiv({ cls: 'claudian-stream-status-phase' });
      phaseEl.createSpan({ cls: 'claudian-stream-status-phase-index', text: String(index + 1) });
      phaseEl.createSpan({ cls: 'claudian-stream-status-phase-label', text: phase });
      this.phaseEls.push(phaseEl);
    });
    this.activityHistoryEl = this.detailEl.createDiv({ cls: 'claudian-stream-status-history' });
    this.renderPhases();
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
    const nextPrimary = primary || 'Arbeitet';
    const nextMeta = meta || this.currentLabel;
    const wasCurrentActivity = this.currentActivity === nextPrimary && this.currentMeta === nextMeta;
    this.currentActivity = nextPrimary;
    this.currentMeta = nextMeta;
    this.currentStage = resolveActivityStage(nextPrimary);
    if (!wasCurrentActivity) {
      this.lastActivityAt = this.now();
      this.setWaiting(false);
      this.activities = appendActivity(this.activities, {
        primary: nextPrimary,
        meta: nextMeta,
        at: this.now(),
      });
    }
    this.activityEl.setText(this.currentActivity);
    this.renderEventCount();
    this.renderPhases();
    this.toggleEl.setAttribute('aria-label', `Live-Aktivität anzeigen: ${this.currentActivity}`);
    this.renderDetail();
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen;
    this.el.toggleClass('is-open', this.isOpen);
    this.toggleEl.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
  }

  private start(): void {
    this.startedAt = this.now();
    this.lastActivityAt = this.startedAt;
    this.setWaiting(false);
    this.activities = [];
    this.currentActivity = 'Starte Provider-Turn';
    this.currentMeta = this.currentLabel;
    this.currentStage = resolveActivityStage(this.currentActivity);
    this.activities = appendActivity(this.activities, {
      primary: this.currentActivity,
      meta: this.currentMeta,
      at: this.startedAt,
    });
    this.renderedEventCount = 0;
    this.renderEventCount();
    this.renderPhases();
    this.renderDetail();
    this.renderTimer();
    this.el.removeClass('claudian-hidden');
    this.clearTimer();
    this.intervalId = window.setInterval(() => this.renderTimer(), TICK_MS);
  }

  private stop(): void {
    this.clearTimer();
    this.setWaiting(false);
    this.el.addClass('claudian-hidden');
    this.el.removeClass('is-open');
    this.isOpen = false;
    this.toggleEl.setAttribute('aria-expanded', 'false');
    this.setLabel('Generiert…');
    this.setPhrase('arbeitet');
    this.currentActivity = 'Warte auf Provider-Events';
    this.currentMeta = 'Noch keine Tool-Aktivität';
    this.currentStage = 1;
    this.activities = [];
    this.renderedEventCount = 0;
    this.cancelEventCountAnimation?.();
    this.cancelEventCountAnimation = null;
    this.eventCountValueEl.setText('0');
    this.renderDetail();
  }

  private renderPhases(): void {
    this.phaseEls.forEach((phaseEl, index) => {
      phaseEl.toggleClass('is-active', index === this.currentStage);
      phaseEl.toggleClass('is-done', index < this.currentStage);
      if (index === this.currentStage) phaseEl.setAttribute('aria-current', 'step');
      else phaseEl.removeAttribute('aria-current');
    });
  }

  /** Toggles the calmer "waiting on a slow provider" state. */
  private setWaiting(waiting: boolean): void {
    if (this.isWaiting === waiting) return;
    this.isWaiting = waiting;
    this.el.toggleClass('is-waiting', waiting);
    this.progressBarEl.toggleClass('is-waiting', waiting);
    this.waitingEl.toggleClass('claudian-hidden', !waiting);
  }

  private renderTimer(): void {
    const nextValue = formatElapsed(this.now() - this.startedAt);
    const changed = this.timerEl.textContent !== nextValue;
    this.timerEl.setText(nextValue);

    // Live "no answer yet" readout: once the provider has been silent past the
    // threshold, show exactly how long — so a slow turn is legible, not scary.
    const silenceMs = this.now() - this.lastActivityAt;
    if (silenceMs > SILENCE_WARN_MS) {
      this.setWaiting(true);
      this.waitingEl.setText(`· ${formatElapsed(silenceMs)} ohne Antwort`);
    } else if (this.isWaiting) {
      this.setWaiting(false);
    }
    const ownerWindow = this.timerEl.ownerDocument?.defaultView ?? window;
    const reduceMotion = ownerWindow.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (changed && !reduceMotion && typeof this.timerEl.animate === 'function') {
      this.timerEl.animate(
        [
          { opacity: 0.45, transform: 'translateY(2px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: 150, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      );
    }
  }

  private renderEventCount(): void {
    const nextCount = this.activities.length;
    this.eventCountEl.setAttribute(
      'aria-label',
      `${nextCount} ${nextCount === 1 ? 'Arbeitsschritt' : 'Arbeitsschritte'}`,
    );
    this.cancelEventCountAnimation?.();
    this.cancelEventCountAnimation = animateNumber(this.eventCountValueEl, nextCount, {
      from: this.renderedEventCount,
      duration: 220,
      formatter: (value) => String(value),
    });
    this.renderedEventCount = nextCount;
  }

  private renderDetail(): void {
    this.activityEl.setText(this.currentActivity);
    this.detailPrimaryEl.setText(this.currentActivity);
    this.detailMetaEl.setText(`${this.currentLabel} · ${this.currentPhrase}${this.currentMeta ? ` · ${this.currentMeta}` : ''}`);
    this.activityHistoryEl.empty();
    if (this.activities.length === 0) return;

    const heading = this.activityHistoryEl.createDiv({ cls: 'claudian-stream-status-history-heading' });
    heading.setText(`Live-Aktivität · ${this.activities.length}`);
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
    this.cancelEventCountAnimation?.();
    this.el.remove();
  }
}
