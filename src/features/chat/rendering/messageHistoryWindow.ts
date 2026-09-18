/**
 * Bounding how much stored history is mounted at once.
 *
 * Obsidian reveals a leaf only after the view's `onOpen()` resolves, and
 * `onOpen()` restores the previously active conversation. Mounting every stored
 * message in one synchronous loop therefore does not merely feel slow — until
 * it finishes the chat pane does not exist on screen, so clicking the ribbon
 * looks like nothing happened at all. A 138-message archive carrying ~3 MB of
 * text and ~200 tool blocks is enough to cross that line.
 *
 * The chat opens scrolled to the bottom, so everything above the last screenful
 * is invisible anyway. Mounting it up front costs the whole freeze and buys the
 * user nothing; the rest arrives when they ask for it.
 */

/** Messages mounted immediately when a conversation is opened. */
export const INITIAL_HISTORY_WINDOW = 30;

/** Messages added per "load older" step. */
export const HISTORY_WINDOW_STEP = 30;

export interface MessageHistoryWindow<T> {
  /** Messages to mount now, oldest first, ending at the newest message. */
  visible: T[];
  /** How many older messages are still unmounted. */
  hidden: number;
}

export function planMessageHistoryWindow<T>(
  messages: readonly T[],
  limit: number = INITIAL_HISTORY_WINDOW,
): MessageHistoryWindow<T> {
  if (limit <= 0 || messages.length <= limit) {
    return { hidden: 0, visible: [...messages] };
  }

  return {
    hidden: messages.length - limit,
    visible: messages.slice(messages.length - limit),
  };
}
