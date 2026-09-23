import type { AttentionReason } from '../state/types';

export interface TabVisibility {
  isActive: boolean;
  /** The chat pane is on screen (not a collapsed sidebar, not a hidden window). */
  isChatVisible: boolean;
  isClosing: boolean;
}

/** A tab only asks for the user when they cannot already see what happened. */
export function shouldRaiseTabAttention(visibility: TabVisibility): boolean {
  if (visibility.isClosing) return false;
  return !(visibility.isActive && visibility.isChatVisible);
}

export function tabAttentionNotice(title: string, reason: AttentionReason): string {
  const quoted = `„${title}“`;
  switch (reason) {
    case 'failed':
      return `${quoted} ist fehlgeschlagen`;
    case 'input':
      return `${quoted} wartet auf dich`;
    case 'finished':
    default:
      return `${quoted} ist fertig`;
  }
}
