import { getIcon, setIcon } from 'obsidian';

/**
 * The pencil T3 Code puts on chats with an unsent draft (Lucide `square-pen`).
 * Older Obsidian builds ship Lucide without it, so fall back to `pencil`.
 */
export function setDraftIcon(el: HTMLElement): void {
  const hasSquarePen = typeof getIcon === 'function' && getIcon('square-pen') !== null;
  setIcon(el, hasSquarePen ? 'square-pen' : 'pencil');
}
