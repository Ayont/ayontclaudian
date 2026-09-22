import type { ComposerDraftContent, ComposerDraftStore } from '../services/ComposerDraftStore';

export interface ComposerDraftSource {
  /** Draft key of whatever the composer currently belongs to. */
  getKey(): string;
  readContent(): ComposerDraftContent;
}

const DEFAULT_DELAY_MS = 250;

/**
 * Saves one tab's composer into the draft store while the user types.
 *
 * The key is captured when the save is scheduled, not when it runs. A switch
 * re-keys the tab before it clears the composer, so a debounce that fired late
 * would otherwise read the next chat's composer and overwrite that chat's draft.
 * Callers flush right before a switch; a save that still arrives late is dropped.
 */
export class ComposerDraftAutosave {
  private timer: number | null = null;
  private pendingKey: string | null = null;
  private disposed = false;

  constructor(
    private readonly store: ComposerDraftStore,
    private readonly source: ComposerDraftSource,
    private readonly delayMs = DEFAULT_DELAY_MS,
  ) {}

  schedule(): void {
    if (this.disposed) return;
    this.pendingKey = this.source.getKey();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const key = this.pendingKey;
      this.pendingKey = null;
      if (key === null || key !== this.source.getKey()) return;
      this.store.set(key, this.source.readContent());
    }, this.delayMs);
  }

  /** Writes a pending save now, under the key it was typed in. */
  flushPending(): void {
    if (this.disposed || this.pendingKey === null) return;
    const key = this.pendingKey;
    this.cancel();
    this.store.set(key, this.source.readContent());
  }

  /** The composer was sent: its draft is no longer a draft. */
  discard(): void {
    if (this.disposed) return;
    this.cancel();
    this.store.delete(this.source.getKey());
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.pendingKey = null;
  }
}
