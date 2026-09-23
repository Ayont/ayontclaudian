/**
 * Placeholder for a tab whose conversation is still loading from disk. A long
 * chat can take a moment on first open; an empty pane read as broken. Shown
 * only after a short delay so fast loads never flash it.
 */
export const SKELETON_DELAY_MS = 120;

const SKELETON_ROWS: ReadonlyArray<'user' | 'assistant'> = ['user', 'assistant', 'user', 'assistant'];

/** Returns the function to call once the transcript is rendered (or the load failed). */
export function scheduleTranscriptSkeleton(messagesEl: HTMLElement): () => void {
  let skeleton: HTMLElement | null = null;
  const timer = window.setTimeout(() => {
    skeleton = messagesEl.createDiv({ cls: 'claudian-transcript-skeleton' });
    skeleton.setAttribute('role', 'status');
    skeleton.setAttribute('aria-label', 'Unterhaltung wird geladen');
    for (const role of SKELETON_ROWS) {
      const row = skeleton.createDiv({ cls: `claudian-transcript-skeleton-row is-${role}` });
      row.setAttribute('aria-hidden', 'true');
      const lines = role === 'user' ? 1 : 3;
      for (let i = 0; i < lines; i++) row.createDiv({ cls: 'claudian-transcript-skeleton-line' });
    }
  }, SKELETON_DELAY_MS);

  return () => {
    window.clearTimeout(timer);
    skeleton?.remove();
    skeleton = null;
  };
}
